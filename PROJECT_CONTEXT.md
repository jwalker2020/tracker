# Project Context

For external reviewers: a concise overview of the codebase without code.

---

## Project purpose

Web app for **uploading, enriching, and viewing GPX tracks**. Users upload GPX files; the app optionally enriches them with elevation (from DEM tiles and/or existing GPX `<ele>`), then displays tracks on a map with elevation, grade, and curviness profiles. Tracks can be filtered by average grade, maximum grade, and curviness. Auth is per-user; each user sees only their own files.

---

## Main stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **PocketBase**: backend, file storage, and auth (runs as separate process in `apps/pb/`)
- **Tailwind CSS** for styling
- **pnpm** workspace (root, `apps/web`, `apps/pb`, `tools/dem`)
- **Leaflet** + **react-leaflet** for the map; **ECharts** (echarts-for-react) for elevation/grade/curviness charts
- **Turf.js** for geodesic length and geometry; **GeoTIFF** + **proj4** for DEM sampling when configured

---

## Major modules

- **`apps/web`** – Next.js app: API routes, server and client components, libs.
- **`apps/web/src/lib`** – Core logic:
  - **`dem/`** – GPX extraction (`gpx-extract`), DEM tile index, raster sampling, elevation enrichment (per-track and GPX-only), elevation stats, curviness/grade helpers.
  - **`gpx/`** – Parse, geometry fetch, file records (including `gpxRecordToDisplay`: summary + `hasEnrichmentArtifact`), validation.
  - **`enrichment/`** – Job executor (`runEnrichmentJob`), artifact streaming (NDJSON to temp file, upload to PocketBase), worker loop; worker polls for jobs and runs enrichment (calls DEM lib, writes progress/cancel and artifact to PocketBase).
  - **`auth`** – Get current user from PocketBase cookie (or optional `GUEST_USER_ID` for dev).
  - **`maps/`** – Basemap/hillshade config, overlays.
  - **`units`** – Meter ↔ feet for display.
- **`apps/web/src/components`** – UI: GPX upload/list/view, track filters, elevation/grade/curviness profiles, map view.
- **`apps/web/src/app/api`** – REST-style API for auth, GPX CRUD, upload, enrich, enrichment progress, and cancel.
- **`apps/pb`** – PocketBase app (migrations, data). Serves API, stores `gpx_files`, `enrichment_jobs`, and `enrichment_artifacts`.
- **`tools/dem`** – Scripts to build DEM manifest and download tiles (e.g. for a region).

---

## Important API routes

- **`POST /api/auth/login`** – Authenticate with PocketBase; sets auth cookie.
- **`GET /api/gpx/files`** – List GPX file records for the current user (with active job ids and `hasEnrichmentArtifact`). Returns summary data only; no full profile payloads.
- **`GET /api/gpx/files/[id]/file`** – Raw GPX file bytes (ownership checked).
- **`GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N`** – One track’s enrichment detail (profile JSON, etc.) from the NDJSON artifact; used for charts. No full-artifact fetch exists.
- **`PATCH /api/gpx/files`** – Reorder files (ownership checked per record).
- **`POST /api/gpx/upload`** – Upload GPX; creates `gpx_files` record with current user as owner.
- **`DELETE /api/gpx/files/[id]`** – Delete file; verifies owner, cancels any active enrichment for that file.
- **`POST /api/gpx/enrich`** – Start enrichment (sync or async; large sync jobs are rerouted to async). When `DEM_BASE_PATH` is unset, **GPX-only enrichment** (elevation from GPX `<ele>` only).
- **`GET /api/gpx/enrichment-progress?jobId=...`** – Poll progress for a job; returns status, phase, percent; ownership checked via job’s `userId`.
- **`POST /api/gpx/enrichment-cancel`** – Cancel a running job; body includes `recordId`; ownership verified against the GPX record.

---

## GPX enrichment pipeline

- **Entry**: `POST /api/gpx/enrich` (sync or async). Large sync jobs are rerouted to async. Async jobs are run by a **separate worker process** (`pnpm run enrichment-worker`); the web app creates the job and returns `jobId`; the worker polls for claimable jobs and runs `runEnrichmentJob`.
- **Parsing**: Server-side `extractTracks()` (in `lib/dem/gpx-extract`) parses GPX XML: per `<trk>`/`<rte>`, collects `<trkpt>`/`<rtept>` with lat, lon, and optional `<ele>`. **Parser behavior**: standard `getElementsByTagName("ele")` (and `"name"`) first; only when that returns no element does the code fall back to **local-name matching** (so namespaced GPX 1.1 e.g. Strava works). **Geometry**: GPX lat/lon is always authoritative for positions; DEM affects only elevation, not coordinates.
- **Elevation source priority**: (1) **GPX `<ele>`** — used when present and valid (finite number). (2) **DEM sampling** — only when GPX elevation is missing or invalid, and `DEM_BASE_PATH` is set and the point is in DEM extent. (3) **Missing** — otherwise the point has no elevation; stats aggregate over valid points only. When `DEM_BASE_PATH` is unset, **GPX-only enrichment**: no DEM tile reads; elevation and metrics from GPX geometry and `<ele>` only.
- **Per-track flow**: Each track is enriched separately. With DEM: optional resampling at fixed spacing, cumulative distance along line, DEM sampling for points without GPX ele, smoothing, then elevation stats and profile. GPX-only: cumulative distance along raw points (zero-length segments handled), GPX elevation, same stats/profile pipeline.
- **Duplicate / zero-distance**: Cumulative distance uses segment length (duplicate consecutive points add 0). Stats and max-grade logic skip zero or tiny segments; curviness uses collapsed duplicate points for turn-angle computation.

### Enrichment storage model

- **`gpx_files`** holds **lightweight summaries only**: `enrichedTracksSummary` (per-track stats, no profile points), `hasEnrichmentArtifact`, and `enrichmentArtifactIndex` (byte offsets per track into the artifact). Inline `enrichedTracksJson` is no longer the primary path; it is cleared when artifact-backed enrichment is used.
- **`enrichment_artifacts`** holds the **full detail**: one record per GPX file, with an **NDJSON** file (one JSON line per track). The index on `gpx_files` gives `{ trackIndex, start, length }` so the API can serve a single track’s slice without loading the whole artifact.
- **Write path (sync and async)**: Both use the same artifact-backed model. Enriched tracks are streamed to a temp file as NDJSON; the artifact file is then streamed to PocketBase. Only after a successful artifact upload are `gpx_files` updated with `hasEnrichmentArtifact`, `enrichmentArtifactIndex`, and `enrichedTracksSummary`.

### Enrichment read path

- **List, filter, selection**: Use `GET /api/gpx/files` and the summary data on each record (`enrichedTracksSummary`, `hasEnrichmentArtifact`). No full-artifact fetch.
- **Charts (elevation, grade, curviness)**: Require per-track profile data. When `hasEnrichmentArtifact` is true, the client requests **`GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N`** for the selected track. The API uses the index to read only that track’s slice from the artifact (Range request when supported). The response is one track’s JSON; the client parses it and merges into local state. If the request fails or parse fails, the UI shows “Elevation profile not available for this track” with bounded retry behavior.

---

## Progress / cancel model

- **Enrichment jobs** are stored in PocketBase (`enrichment_jobs`): one record per job, keyed by `jobId`, linked to `recordId` (GPX file) and `userId` (owner). Progress and cancel state are **PocketBase-backed**; no in-memory store.
- **Progress**: The **enrichment worker** (not the web app) calls `updateJobProgress()` at a throttled cadence. Clients poll **`GET /api/gpx/enrichment-progress?jobId=...`**; the API returns data from the job record; access is restricted to the job owner (`userId`).
- **Cancel**: Client calls **`POST /api/gpx/enrichment-cancel`** with `recordId`. Server verifies the GPX record is owned by the current user, then marks the job’s status as `cancelled`. The worker’s `runEnrichmentJob` checks `isCancelled()` periodically and exits cleanly.
- **Resume**: The worker polls for claimable/incomplete jobs and runs `runEnrichmentJob` for each; the web app never runs or resumes enrichment.

---

## Chart / map interaction

- **Three profiles** (elevation, curviness, grade) share a common **hover index** and **distance range** (zoom). They depend on **per-track detail** from the enrichment-artifact API; if that fetch has not succeeded, the panel shows “Loading profile…” or “Elevation profile not available for this track.”
- **Map**: For the selected track, a marker or highlight moves to the lat/lng corresponding to the hovered profile index (using stored profile points or track geometry). Zoom on one chart (drag to select range) updates the shared range; the map can use the same range to highlight the segment (implementation may vary).
- **Coordinates**: Always from GPX (profile points carry lat/lng from enrichment; track geometry is from GPX or enriched GeoJSON).

---

## Filtering system

- **Track-level filters** (not file-level): average grade (%), maximum grade (%), curviness (°/mi). Stored in component state as min/max per metric.
- **Data bounds**: From the set of tracks in the currently **selected** GPX files; each filter’s min/max is clamped to that data range.
- **RangeFilter**: Dual-handle range slider (min/max); commits on pointer release; used for each of the three metrics in **TrackFilters**.
- **Visibility**: A track is visible if it falls within all three filter ranges (and is in the selected files). `visibleTrackKeys` is the set of `fileId-trackIndex` that pass; the map draws only those polylines; the file list / detail view reflect the same selection.

---

## Auth / ownership model

- **Auth**: PocketBase session; user logs in via **`POST /api/auth/login`**. Server reads auth from the request cookie and resolves current user with **`getCurrentUserId(request)`** (or optional `GUEST_USER_ID` in dev).
- **Ownership**: `gpx_files` records have a `user` field (owner). All GPX API routes (list, upload, delete, enrich, progress, cancel) require an authenticated user and enforce that the resource is owned by that user (e.g. list filtered by user; delete/enrich/cancel check `record.user === userId`). Enrichment job records store `userId` so progress and cancel APIs can restrict access to the job owner.

---

## Deployment assumptions

- **Production model (Docker Compose / Coolify):** Three services — **web** (public), **worker** (internal-only), **pocketbase** (internal-only). Same app image runs web and worker (different `command`). All share an internal Docker network (`tracker`). Only the web service is exposed (port 3000); Cloudflare Tunnel points only at web. Public URL: **https://tracker.nhwalker.net**. PocketBase and worker must never have a public hostname, tunnel, or exposed port. Admin accesses PocketBase via LAN or WireGuard only (SSH port-forward or LAN-restricted host port).
- **PocketBase URL:** In this stack, **`NEXT_PUBLIC_PB_URL`** is set to **`http://pocketbase:8090`** (internal hostname). Web and worker use it for server-side API calls. The **browser does not call PocketBase directly**; geometry, auth, and file requests go through the Next.js app (same-origin API).
- **PocketBase persistence:** Data is stored in a named volume **`pb_data`** at **`/app/pb_data`**; must be attached in Coolify so data survives restarts. On first deployment, create the initial admin user via LAN/WireGuard or temporary local-only port exposure.
- **Optional DEM:** **`DEM_BASE_PATH`** (and optionally **`DEM_MANIFEST_PATH`**) configure server-side DEM tile location. If unset, **GPX-only enrichment** runs: no DEM tiles; elevation and metrics from GPX geometry and `<ele>` only. Worker gets env from container (no `.env.local`).
- **Enrichment worker:** Runs as a **separate process or container** (`pnpm run enrichment-worker` locally; in Docker, `node --import tsx scripts/enrichment-worker.ts`). **Worker:** poll for claimable jobs, claim one, run `runEnrichmentJob` (load GPX, DEM/GPX elevation, write progress/checkpoint, complete or fail). **Web:** create/locate job on enrich request, return `jobId`; serve progress and cancel APIs from PocketBase. Progress and cancel state are PocketBase-backed; worker checks for cancellation during the run.
- **File serving:** GPX file bytes are stored in PocketBase. The **web app** fetches them server-side (e.g. geometry API, enrich flow) and serves the client via same-origin routes; the **worker** fetches GPX from PocketBase when running enrichment. The browser never requests PocketBase file URLs directly.

---

## Units and conventions

- Internal calculations (DEM, Turf, geodesic) use **meters**.
- User-facing elevation and distance are converted to **feet** and **miles** in display and when returning data to the client (see `lib/units.ts` and `gpxRecordToDisplay` in `lib/gpx/files.ts`).
- App Router only; dynamic route params are async in Next.js 16. Prefer server components; Tailwind for styling; strict TypeScript.

---

## Debugging enrichment and profiles

- **Enrichment persistence**: After a job completes, the worker uploads the NDJSON artifact to `enrichment_artifacts` and updates the `gpx_files` record with `hasEnrichmentArtifact`, `enrichmentArtifactIndex`, and `enrichedTracksSummary`. Check PocketBase for the artifact record and that the file record has these fields. Worker logs: “Artifact persisted”, “Enrichment results saved.”
- **Artifact slice API**: `GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N` requires the record to have `enrichmentArtifactIndex` and the artifact file to exist. The API uses Range requests when the backend supports them; see route logs for range vs full fetch. 4xx/5xx or missing index indicate wrong record state or missing migration.
- **Client per-track loading**: MapView fetches the artifact slice only when `file.hasEnrichmentArtifact` is true. Ensure the file list is refetched after enrichment completes so the client receives `hasEnrichmentArtifact: true` (see `gpxRecordToDisplay` in `lib/gpx/files.ts`). In the browser Network tab, confirm a request to `.../enrichment-artifact?trackIndex=...` for the selected track, not only `.../file`.
- **“Elevation profile not available for this track”**: Usually means (1) the file list never had `hasEnrichmentArtifact` (refetch or list API not including it), (2) the artifact request failed (check status and console), or (3) the slice response failed to parse. Check console for “[MapView] Per-track artifact fetch failed” or “parse failed”; failed loads are retried after a cooldown. Verify the same-origin API and auth (cookies) so the artifact route can read the artifact from PocketBase.
