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
  - **`gpx/`** – Parse, enrich (legacy to-GeoJSON path), geometry fetch, file records, validation.
  - **`enrichment/`** – Job executor (`runEnrichmentJob`) and worker loop; worker process polls for jobs and runs enrichment (calls DEM lib, writes progress/cancel to PocketBase).
  - **`auth`** – Get current user from PocketBase cookie (or optional `GUEST_USER_ID` for dev).
  - **`maps/`** – Basemap/hillshade config, overlays.
  - **`units`** – Meter ↔ feet for display.
- **`apps/web/src/components`** – UI: GPX upload/list/view, track filters, elevation/grade/curviness profiles, map view.
- **`apps/web/src/app/api`** – REST-style API for auth, GPX CRUD, upload, enrich, enrichment progress, and cancel.
- **`apps/pb`** – PocketBase app (migrations, data). Serves API, stores `gpx_files` and `enrichment_jobs`.
- **`tools/dem`** – Scripts to build DEM manifest and download tiles (e.g. for a region).

---

## Important API routes

- **`POST /api/auth/login`** – Authenticate with PocketBase; sets auth cookie.
- **`GET /api/gpx/files`** – List GPX file records for the current user (with active job ids for progress).
- **`PATCH /api/gpx/files`** – Reorder files (ownership checked per record).
- **`POST /api/gpx/upload`** – Upload GPX; creates `gpx_files` record with current user as owner.
- **`DELETE /api/gpx/files/[id]`** – Delete file; verifies owner, cancels any active enrichment for that file.
- **`POST /api/gpx/enrich`** – Start enrichment (sync or async). Optional `DEM_BASE_PATH`; when unset, enrichment uses GPX elevation only.
- **`GET /api/gpx/enrichment-progress?jobId=...`** – Poll progress for a job; returns status, phase, percent; ownership checked via job’s `userId`.
- **`POST /api/gpx/enrichment-cancel`** – Cancel a running job; body includes `recordId`; ownership verified against the GPX record.

---

## GPX enrichment pipeline

- **Entry**: `POST /api/gpx/enrich` (sync or async). Async jobs are run by a **separate worker process** (`pnpm run enrichment-worker`); the web app creates the job and returns `jobId`; the worker polls for claimable jobs and runs `runEnrichmentJob`.
- **Parsing**: Server-side `extractTracks()` (in `lib/dem/gpx-extract`) parses GPX XML: per `<trk>`/`<rte>`, collects `<trkpt>`/`<rtept>` with lat, lon, and optional `<ele>` (namespace-safe for GPX 1.1). Geometry is always GPX lat/lon.
- **Elevation source**: If a point has valid GPX `<ele>`, that value is used and DEM is not sampled for it. DEM is used only for points missing or invalid elevation (and only when `DEM_BASE_PATH` is set). If `DEM_BASE_PATH` is unset, enrichment runs in a **GPX-only** mode: no DEM; elevation and metrics come from GPX geometry and `<ele>` only.
- **Per-track flow**: Each track is enriched separately. With DEM: optional resampling at fixed spacing, cumulative distance along line, DEM sampling for points without GPX ele, smoothing, then elevation stats and profile. GPX-only: cumulative distance along raw points (zero-length segments handled), GPX elevation, same stats/profile pipeline.
- **Output**: Per-track summary (distance, min/max elevation, ascent/descent, average/max grade, curviness, elevation profile JSON) and file-level aggregates; written to `gpx_files` (and optionally checkpoint for resume).
- **Duplicate / zero-distance**: Cumulative distance uses segment length (duplicate consecutive points add 0). Stats and max-grade logic skip zero or tiny segments; curviness uses collapsed duplicate points for turn-angle computation.

---

## Progress / cancel model

- **Enrichment jobs** are stored in PocketBase (`enrichment_jobs`): one record per job, keyed by `jobId`, linked to `recordId` (GPX file) and `userId` (owner).
- **Progress**: Background runner calls `updateJobProgress()` at a throttled cadence with processed points, total points, phase, and overall percent. Clients poll **`GET /api/gpx/enrichment-progress?jobId=...`**; response is restricted to the current user’s job (`userId` must match).
- **Cancel**: Client calls **`POST /api/gpx/enrichment-cancel`** with `recordId`. Server verifies the GPX record is owned by the current user, then marks the job’s status as `cancelled`. The running enrichment checks `isCancelled()` periodically and exits cleanly.
- **Resume**: The **enrichment worker** polls for incomplete jobs (running/resumable) and runs `runEnrichmentJob` for each; progress and checkpoint records are used so work can continue. The web app does not run or resume enrichment.

---

## Chart / map interaction

- **Three profiles** (elevation, curviness, grade) share a common **hover index** and **distance range** (zoom). Each chart reports hover by distance; the parent maps that to a profile-point index and passes it to the map.
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

- **PocketBase** runs as a separate process; its URL is set via **`NEXT_PUBLIC_PB_URL`** (e.g. `http://localhost:8090` or production URL). The Next.js app uses this for API calls and auth cookie domain.
- **Optional DEM**: **`DEM_BASE_PATH`** (and optionally **`DEM_MANIFEST_PATH`**) configure server-side DEM tile location. If unset, enrichment still runs using GPX elevation only; no DEM tiles are loaded.
- **Enrichment worker**: Run the worker separately (`pnpm run enrichment-worker` from `apps/web`). It polls for claimable jobs and runs one at a time. Progress and cancel are stored in PocketBase so the UI can poll and request cancel; the worker checks for cancellation during the run.

---

## Units and conventions

- Internal calculations (DEM, Turf, geodesic) use **meters**.
- User-facing elevation and distance are converted to **feet** and **miles** in display and when returning data to the client (see `lib/units.ts` and `gpxRecordToDisplay` in `lib/gpx/files.ts`).
- App Router only; dynamic route params are async in Next.js 16. Prefer server components; Tailwind for styling; strict TypeScript.
