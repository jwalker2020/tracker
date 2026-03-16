# Current State

Concise status for maintainers and contributors. Update as the project evolves.

---

## Recent changes

- **Artifact-backed enrichment:** Sync and async use the **same storage model**. **`gpx_files`** = summary only; full detail in **`enrichment_artifacts`** (NDJSON; each line = one track). Index `{ trackIndex, start, length }` on `gpx_files`; artifact API returns **one track slice only** (Range when backend supports it, else server fetches artifact and slices in memory). Write: stream to temp NDJSON → stream upload to PocketBase → then update `gpx_files`. Inline `enrichedTracksJson` cleared when artifact is used. **Sync vs async:** Sync enrichment is used only for small files; files exceeding approximately **15,000 points** or **50 tracks** (`SYNC_MAX_POINTS`, `SYNC_MAX_TRACKS`) are **automatically rerouted to async** worker processing.
- **Read path:** List/filter/selection use **summary only**. Chart detail: client requests **per-track slice** (`GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N`) on demand. No full-artifact fetch. “Elevation profile not available” → missing `hasEnrichmentArtifact`, failed request, parse failure, or not yet loaded.
- **Regression fix:** File list now correctly exposes `hasEnrichmentArtifact` to the client (`gpxRecordToDisplay` in `lib/gpx/files.ts`), so the UI requests the artifact slice and profiles can load after enrichment.
- **Production deployment (Docker Compose / Coolify):** Approved model documented in `docs/PRODUCTION_DEPLOYMENT.md` and `docs/deployment.md`. Web only public; worker and PocketBase internal-only. PocketBase data in volume `pb_data`; admin via LAN or WireGuard.
- **Worker-based enrichment:** Async jobs run only in a separate worker process/container. Web creates jobs and returns `jobId`; worker polls and runs `runEnrichmentJob`. No in-process runner or startup resume in the web app.
- **GPX elevation pipeline:** GPX-only enrichment when `DEM_BASE_PATH` is unset; GPX `<ele>` takes priority when DEM is set. Parser local-name fallback for GPX 1.1 namespaced. Duplicate/zero-distance segments handled.
- **Charts:** ECharts crosshair/floating label removed; tooltips retained. Grade chart padding. Charts require per-track artifact slice; UI shows “Loading profile…” or “not available” when slice not yet loaded or failed.
- **Leaflet resize on panel close:** Clearing the selected track unmounts the bottom chart panel; the map container then grows in height (flex layout). Leaflet does not observe that DOM size change. **`MapResizeOnSelectionClear`** (in MapView) calls `map.invalidateSize()` on the transition from selected track → no selection so the map redraws to the new size and no gray bar remains where the panel was.
- **Track filters:** The UI supports **five track-level filters**: average grade, maximum grade, curviness, average elevation, and maximum elevation. Filtering is track-level (not file-level). Average elevation and maximum elevation use summary metrics computed during enrichment; tracks without valid elevation data are excluded when an elevation filter is active.
- **Docs:** PROJECT_CONTEXT.md, CURRENT_STATE.md, EXTERNAL_REVIEW_SUMMARY.md, KNOWN_ISSUES.md, and deployment docs aligned with artifact-backed architecture, read/write paths, and debugging.

---

## Open bugs

- None filed. **Known behavior**: If a GPX has no `<ele>` and DEM is not configured (or track is outside DEM coverage), enrichment completes but may return an “all nodata / out of extent”–style warning and not persist elevation stats (by design).

---

## Fragile areas

- **Checkpoint / progress**: Depends on PocketBase `enrichment_jobs` schema. If migrations were not run, checkpoint lookup can throw; enrich route logs “run migrations?” and continues without resume. **Progress and checkpoint writes are best-effort**: failures are logged; enrichment continues (no retry or block).
- **RangeFilter**: Drag state kept in refs and a tick to avoid parent re-renders resetting handles; subtle if parent state or bounds change during drag.
- **Enrichment worker:** Runs separately (or as separate container). Web does not run jobs. **Worker processes jobs sequentially** (one job at a time per process). Progress/cancel are PocketBase-backed. In production, worker has no HTTP server; internal-only.
- **Per-track artifact fetch**: Can fail independently (network, 4xx/5xx, parse error). Client has bounded retry (cooldown after failure); UI shows “Elevation profile not available for this track.” If the file list never gets `hasEnrichmentArtifact: true` (e.g. list not refetched after job complete), the client never requests the slice. See PROJECT_CONTEXT.md “Debugging enrichment and profiles.”
- **Artifact upload limits:** PocketBase request/body limits apply. Very large artifacts may fail; no chunked multi-file design. Optional guardrail (e.g. `ENRICHMENT_ARTIFACT_MAX_BYTES`) is not implemented but could cap artifact size.

---

## Current workarounds

- **Auth in dev**: Optional **`GUEST_USER_ID`** env lets the app work without a real login cookie; **dev-only**, not for production.
- **Delete vs cancel:** `DELETE /api/gpx/files/[id]` deletes the file record even if cancelling the active enrichment job fails. Cancel is best-effort (e.g. job record not found); the file is still removed so the UI stays consistent.
- **Progress writes**: Throttled; worker continues enrichment even if `updateJobProgress` or checkpoint save fails (logged only).
- **DEM logging**: Some DEM messages use `process.stderr.write`; fallback to `console.warn` when stderr is unavailable.

---

## Pending refactors

- **Partial resume**: Checkpoint state exists in the DEM lib, but the worker currently runs each job from the start of the track list; **partial file-level resume** (e.g. after crash mid-run) is not implemented.
- **Client artifact parse**: The client parses the per-track artifact response as JSON text (one track object). Acceptable for current slice shape; could be formalized or validated.
- **Optional**: Retry UX for failed profile load (e.g. explicit “Retry” that clears cooldown and refetches the artifact slice).

---

## Next recommended tasks

1. **Document migrations**: Ensure `enrichment_jobs` and `enrichment_artifacts` (and related) schema is documented so “run migrations?” is actionable.
2. **Tests**: Unit tests for GPX parsing (ele, local-name fallback, duplicate points), elevation stats, GPX-only vs DEM path; optional integration test for enrich API and artifact slice API with mock PocketBase.
3. **Large-track / artifact handling**: PocketBase upload limits still apply to artifact files; consider downsampling or capping profile points if very large files become an issue. No chunked multi-file artifact design yet.
4. **Error UX**: Surface enrichment warnings (e.g. all nodata, could not save) in the UI (toast or inline), not only in API response.
5. **Optional E2E**: Happy path (upload → enrich → map + profiles) to guard regressions (e.g. Playwright against local dev; run worker separately).
