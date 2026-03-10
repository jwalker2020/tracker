# Current State

Concise status for maintainers and contributors. Update as the project evolves.

---

## Recent changes

- **GPX elevation pipeline**: Enrichment runs without DEM when `DEM_BASE_PATH` is unset; elevation is taken from GPX `<ele>` only. When DEM is set, points with valid GPX elevation skip DEM sampling. Namespace-safe parsing for GPX 1.1 `<ele>` and `<name>` (Strava-style exports work). Duplicate consecutive points and zero-distance segments handled in cumulative distance and stats.
- **Charts**: Vertical mark line and floating metric label removed on hover; tooltips on elevation/grade/curviness charts retained. Grade chart given extra bottom grid padding and panel padding to avoid clipping.
- **PROJECT_CONTEXT.md**: Rewritten for external reviewers (purpose, stack, modules, API, enrichment, progress/cancel, chart–map, filtering, auth, deployment).
- **CURRENT_STATE.md**: Added (this file).

---

## Open bugs

- None filed. Known behavior: if a GPX has no `<ele>` and DEM is not configured (or track is outside DEM coverage), enrichment completes but returns a “all nodata / out of extent”–style warning and does not persist elevation stats (by design).

---

## Fragile areas

- **Checkpoint / progress**: Depends on PocketBase collection `enrichment_jobs` and correct schema. If migrations were not run, checkpoint lookup can throw; enrich route logs “run migrations?” and continues without resume.
- **RangeFilter**: Drag state is kept in refs and a tick to avoid parent re-renders resetting handles; subtle if parent state or bounds change during drag.
- **Background enrichment**: Single Node process; no queue. If the process dies, jobs are only resumed on next startup via `instrumentation.ts`. Progress/checkpoint writes are best-effort (log and continue on failure).
- **Large payloads**: `enrichedTracksJson` is stored on `gpx_files`. Very long tracks can approach or exceed PocketBase field/request limits; runEnrichment logs when JSON length is near ~10M chars after an update failure.

---

## Current workarounds

- **Auth in dev**: Optional `GUEST_USER_ID` env lets the app work without a real login cookie; not for production.
- **Delete despite cancel failure**: DELETE `/api/gpx/files/[id]` still deletes the record if cancelling the enrichment job fails (cancel is best-effort).
- **Progress writes**: Throttled and non-blocking; enrichment continues even if `updateJobProgress` or checkpoint save fails (logged only).
- **DEM logging**: Some DEM messages use `process.stderr.write` for scripts; fallback to `console.warn` when stderr is unavailable.

---

## Pending refactors

- **Legacy elevation profile**: `elevationProfileJson` on `gpx_files` is legacy; display and profiles use `enrichedTracksJson` (per-track). Could be removed or clearly deprecated once all consumers are confirmed.
- **Dual enrichment paths**: `lib/gpx/enrich.ts` (to-GeoJSON + legacy stats) vs `lib/dem/enrich-elevation.ts` (per-track DEM/GPX pipeline). Map/display use enriched geometry and per-track data; legacy path may only be for specific flows—worth confirming and documenting or consolidating.
- **Resume from checkpoint**: Enrichment supports resume state in the DEM lib, but the background runner currently always starts from the beginning of the track list; partial file-level resume (e.g. after crash mid-run) is not implemented.

---

## Next recommended tasks

1. **Document migrations**: Add a short note or script for ensuring `enrichment_jobs` (and any related) schema exists so “run migrations?” is actionable.
2. **Tests**: Unit tests for GPX parsing (`gpx-extract`: ele, namespaces, duplicate points), elevation stats, and enrichment path selection (GPX-only vs DEM); optional integration test for enrich API with mock PB.
3. **Large-track handling**: Consider downsampling or capping profile points for storage when track point count is very high, to avoid PocketBase limits and slow responses.
4. **Error UX**: When enrichment returns a warning (e.g. all nodata, or “could not save”), surface it clearly in the UI (toast or inline) instead of only in API response.
5. **Optional E2E**: One happy path (upload → enrich → see map + profiles) would guard regressions; can be minimal (e.g. Playwright against local dev).
