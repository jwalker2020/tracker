# Current State

Concise status for maintainers and contributors. Update as the project evolves.

---

## Recent changes

- **Worker-based enrichment**: Async enrichment runs only in a **separate worker process** (`pnpm run enrichment-worker`). The web app creates jobs and returns `jobId`; the worker polls for claimable jobs and runs `runEnrichmentJob`. No in-process runner or startup resume in the web app.
- **GPX elevation pipeline**: **GPX-only enrichment** when `DEM_BASE_PATH` is unset; elevation from GPX `<ele>` only. When DEM is set, **GPX `<ele>` takes priority** over DEM; DEM is used only for points missing or invalid elevation. Parser uses local-name fallback only when standard tag lookup returns no result (GPX 1.1 namespaced). Duplicate consecutive points and zero-distance segments handled in distance and stats.
- **Charts**: ECharts axis/crosshair-style vertical hover line and custom floating metric label removed; tooltips retained. Grade chart given extra bottom grid and panel padding to avoid clipping.
- **Docs**: PROJECT_CONTEXT.md, CURRENT_STATE.md, EXTERNAL_REVIEW_SUMMARY.md updated for worker architecture, elevation priority, and reviewer clarity.

---

## Open bugs

- None filed. **Known behavior**: If a GPX has no `<ele>` and DEM is not configured (or track is outside DEM coverage), enrichment completes but may return an “all nodata / out of extent”–style warning and not persist elevation stats (by design).

---

## Fragile areas

- **Checkpoint / progress**: Depends on PocketBase `enrichment_jobs` schema. If migrations were not run, checkpoint lookup can throw; enrich route logs “run migrations?” and continues without resume. **Progress and checkpoint writes are best-effort**: failures are logged; enrichment continues (no retry or block).
- **RangeFilter**: Drag state kept in refs and a tick to avoid parent re-renders resetting handles; subtle if parent state or bounds change during drag.
- **Enrichment worker**: Must be run separately; web app does not run jobs. Worker runs one job at a time per process; progress/cancel state is **PocketBase-backed**.
- **Large payloads**: `enrichedTracksJson` on `gpx_files` can approach or exceed PocketBase limits for very long tracks; `runEnrichmentJob` logs when JSON length is near ~10M chars after an update failure.

---

## Current workarounds

- **Auth in dev**: Optional **`GUEST_USER_ID`** env lets the app work without a real login cookie; **dev-only**, not for production.
- **Delete despite cancel failure**: DELETE `/api/gpx/files/[id]` still deletes the record if cancelling the enrichment job fails (cancel is best-effort).
- **Progress writes**: Throttled; worker continues enrichment even if `updateJobProgress` or checkpoint save fails (logged only).
- **DEM logging**: Some DEM messages use `process.stderr.write`; fallback to `console.warn` when stderr is unavailable.

---

## Pending refactors

- **Legacy elevation profile**: **elevationProfileJson** (file-level or per-track) is legacy; **enrichedTracksJson** is primary. Display prefers enrichedTracksJson when available; legacy remains supported. Deprecate or remove once all consumers are confirmed.
- **Dual enrichment paths**: `lib/gpx/enrich.ts` (to-GeoJSON + legacy stats) vs `lib/dem/enrich-elevation.ts` (per-track DEM/GPX pipeline). Map/display use enriched geometry and per-track data; consolidate or document which flows use which path.
- **Partial resume**: Checkpoint state exists in the DEM lib, but the worker currently runs each job from the start of the track list; **partial file-level resume** (e.g. after crash mid-run) is not implemented.

---

## Next recommended tasks

1. **Document migrations**: Ensure `enrichment_jobs` (and related) schema is documented so “run migrations?” is actionable.
2. **Tests**: Unit tests for GPX parsing (ele, local-name fallback, duplicate points), elevation stats, GPX-only vs DEM path; optional integration test for enrich API with mock PocketBase.
3. **Large-track handling**: Consider downsampling or capping profile points for storage to avoid PocketBase limits and slow responses.
4. **Error UX**: Surface enrichment warnings (e.g. all nodata, could not save) in the UI (toast or inline), not only in API response.
5. **Optional E2E**: Happy path (upload → enrich → map + profiles) to guard regressions (e.g. Playwright against local dev; run worker separately).
