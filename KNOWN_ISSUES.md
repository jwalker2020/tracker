# Known Issues

This file tracks known bugs, limitations, and operational concerns so maintainers and reviewers can quickly see current risk areas without rediscovering them. When an issue listed here is fixed, remove it from this file and reference the fix in commit or release notes.

Last updated: 2025-03-10

---

## Functional Issues

- **No elevation without GPX `<ele>` or DEM**
  - If a GPX file contains no `<ele>` and DEM is not configured (or the track is outside DEM coverage), enrichment runs but produces no elevation stats.
  - The API may return an “all nodata / out of extent”–style warning and skip persisting elevation stats. This is by design.

- **Very large tracks can exceed PocketBase limits**
  - `enrichedTracksJson` can become very large for very long tracks.
  - PocketBase request/field size limits may cause save failures.
  - The worker logs warnings when payload size approaches ~10M characters after a failed save attempt.

- **GPX elevation units**
  - GPX elevation is assumed to be in meters (per GPX 1.1); there is no detection or conversion for feet.

---

## Performance / Scalability

- **Large enrichedTracksJson payloads**
  - File-record responses (e.g. `GET /api/gpx/files`) include `enrichedTracksJson`, so large tracks increase payload size.
  - This can slow page load and client-side parsing.

- **Single job per worker process**
  - The enrichment worker runs one job at a time per process.
  - Multiple concurrent jobs require additional worker processes.

---

## Operational Issues

- **PocketBase migrations must be applied**
  - If the `enrichment_jobs` schema is missing or out of date, checkpoint lookups can throw.
  - The enrich route logs “run migrations?” and continues without resume; progress/resume features may not work correctly.

- **Worker must be running for async enrichment**
  - Async enrichment depends on the enrichment worker (`pnpm run enrichment-worker` from `apps/web` locally; in Docker/Coolify, the worker runs as a separate container with the same image).
  - If the worker is not running, async jobs remain pending. In production, do not expose the worker; it has no HTTP server and must remain internal-only.

- **Production: only web is public**
  - In Docker Compose / Coolify, only the web service must have a public domain, ingress, or exposed port. Worker and PocketBase are internal-only; PocketBase must never have a public hostname or tunnel. Admin access to PocketBase is via LAN or WireGuard only (see `docs/PRODUCTION_DEPLOYMENT.md`).

- **Worker restart does not partially resume jobs**
  - If the enrichment worker crashes or is restarted mid-job, the job currently restarts from the beginning.
  - Checkpoint state exists, but partial resume from the last processed point or track is not implemented.

- **Guest auth is dev-only**
  - `GUEST_USER_ID` is a dev fallback when no login cookie is present; it is not for production use.

- **Delete despite cancel failure**
  - `DELETE /api/gpx/files/[id]` still deletes the record if cancelling the enrichment job fails (cancel is best-effort).

---

## Fragile Areas in the Code

- **RangeFilter drag logic**
  - Uses refs and a manual tick to avoid React re-renders resetting the slider handles during drag.
  - Can be subtle if parent state or bounds change while dragging.

- **Checkpoint / progress persistence**
  - Progress and checkpoint writes are best-effort; failures are logged but enrichment continues (no retry or block).
  - Throttled writes; worker does not stop if `updateJobProgress` or checkpoint save fails.

---

## Technical Debt

- **Dual enrichment pipelines**
  - `lib/gpx/enrich.ts` (to-GeoJSON + legacy stats) vs `lib/dem/enrich-elevation.ts` (per-track DEM/GPX pipeline).
  - Map/display use enriched geometry and per-track data; worth consolidating or documenting which flows use which path.

- **Legacy elevationProfileJson**
  - File-level or per-track `elevationProfileJson` is legacy; `enrichedTracksJson` is primary.
  - Display prefers `enrichedTracksJson` when available; legacy remains supported. Should be deprecated or removed once all consumers are confirmed.

- **Partial resume not implemented**
  - Checkpoint state exists in the DEM lib, but the worker runs each job from the start of the track list.
  - No partial file-level resume (e.g. after crash mid-run).

---

## Future Improvements

Items already noted in project docs; not speculative:

- **Partial resume from checkpoints** — Worker resumes from last persisted checkpoint per track after a crash instead of restarting the full file.
- **Large-track downsampling** — Downsample or cap profile points for storage to avoid PocketBase limits and slow responses.
- **Consolidating enrichment paths** — Unify or clearly document `lib/gpx/enrich.ts` vs `lib/dem/enrich-elevation.ts`.
- **Improved error reporting in UI** — Surface enrichment warnings (e.g. all nodata, could not save) in the UI (toast or inline), not only in the API response.
- **Deprecate legacy elevationProfileJson** — Once all consumers use `enrichedTracksJson`.
