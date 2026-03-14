# Known Issues

This file tracks known bugs, limitations, and operational concerns so maintainers and reviewers can quickly see current risk areas without rediscovering them. When an issue listed here is fixed, remove it from this file and reference the fix in commit or release notes.

Last updated: 2026-03-10

---

## Functional Issues

- **No elevation without GPX `<ele>` or DEM**
  - If a GPX file contains no `<ele>` and DEM is not configured (or the track is outside DEM coverage), enrichment runs but produces no elevation stats.
  - The API may return an “all nodata / out of extent”–style warning and skip persisting elevation stats. This is by design.

- **Very large artifacts can exceed PocketBase upload limits**
  - Full enrichment detail is stored in `enrichment_artifacts` (NDJSON file). PocketBase request/body limits apply to the artifact file upload.
  - Very large files (many tracks or very long tracks) may hit limits; the worker logs upload success or failure. No chunked multi-file artifact design yet.

- **GPX elevation units**
  - GPX elevation is assumed to be in meters (per GPX 1.1); there is no detection or conversion for feet.

---

## Performance / Scalability

- **List payload**
  - `GET /api/gpx/files` returns summary data only (`enrichedTracksSummary`, `hasEnrichmentArtifact`). Full profile data is loaded per track via `GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N`, so list size is bounded.

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

- **Partial resume not implemented**
  - Checkpoint state exists in the DEM lib, but the worker runs each job from the start of the track list.
  - No partial file-level resume (e.g. after crash mid-run).

- **Client artifact parse**
  - The client parses the per-track artifact response as JSON text (one track object). No formal schema validation; acceptable for current slice shape.

---

## Debugging “Elevation profile not available for this track”

- **Cause**: Charts need per-track detail from `GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N`. The message appears when (1) the file list never had `hasEnrichmentArtifact: true` (list not refetched after enrichment, or list API not passing the flag), (2) the artifact request failed (4xx/5xx or network), or (3) the slice response failed to parse.
- **Checks**: In the browser Network tab, confirm a request to `.../enrichment-artifact?trackIndex=...` for the selected track (not only `.../file`). If the artifact request never appears, the file in client state likely lacks `hasEnrichmentArtifact` — refetch the file list or refresh. Check console for “[MapView] Per-track artifact fetch failed” or “parse failed”; failed loads are retried after a cooldown.
- **Full guide**: See **PROJECT_CONTEXT.md** section “Debugging enrichment and profiles” for persistence, artifact slice API, and client loading.

---

## Future Improvements

Items already noted in project docs; not speculative:

- **Partial resume from checkpoints** — Worker resumes from last persisted checkpoint per track after a crash instead of restarting the full file.
- **Large-track / artifact handling** — Downsample or cap profile points if artifact upload limits become an issue; no chunked multi-file artifact design yet.
- **Improved error reporting in UI** — Surface enrichment warnings (e.g. all nodata, could not save) in the UI (toast or inline), not only in the API response.
- **Optional retry UX for profile load** — Explicit “Retry” to clear cooldown and refetch the artifact slice when “Elevation profile not available” is shown.
