# Project Context

For external reviewers: a concise overview of the codebase without code.

---

## Project purpose

Web app for **uploading, enriching, and viewing GPX tracks**. Users upload GPX files; the app optionally enriches them with elevation (from DEM tiles and/or existing GPX `<ele>`), then displays tracks on a map with elevation, grade, and curviness profiles. Tracks can be filtered by average grade, maximum grade, curviness, average elevation, and maximum elevation. Auth is per-user; each user sees only their own files.

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
- **`GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N`** – Returns **one track’s slice only** (that track’s JSON from the NDJSON artifact). Used for charts. **The artifact API never returns the full artifact file.** Clients must request a single track using `trackIndex`, which allows large artifacts (thousands of tracks) to scale without loading the full artifact into memory. The API uses `enrichmentArtifactIndex` to read the slice: when the file backend supports HTTP Range requests, only that byte range is fetched; otherwise the server fetches the artifact and slices it in memory. No full-artifact fetch path exists.
- **`PATCH /api/gpx/files`** – Reorder files (ownership checked per record).
- **`POST /api/gpx/upload`** – Upload GPX; creates `gpx_files` record with current user as owner.
- **`DELETE /api/gpx/files/[id]`** – Delete file; verifies owner, cancels any active enrichment for that file.
- **`POST /api/gpx/enrich`** – Start enrichment. **Sync** (small jobs only) or **async** (worker). Jobs above the sync size limit (point/track count) are **rerouted to async**; both paths use the same artifact-backed storage. When `DEM_BASE_PATH` is unset, **GPX-only enrichment** (elevation from GPX `<ele>` only).
- **`GET /api/gpx/enrichment-progress?jobId=...`** – Poll progress for a job; returns status, phase, percent; ownership checked via job’s `userId`.
- **`POST /api/gpx/enrichment-cancel`** – Cancel a running job; body includes `recordId`; ownership verified against the GPX record.

---

## High-Level Architecture

```
Upload GPX
   │
   ▼
POST /api/gpx/enrich
   │
   ├─ small job → sync enrichment
   └─ large job → async job
                    │
                    ▼
              enrichment worker
                    │
                    ▼
       stream NDJSON artifact file
                    │
                    ▼
          upload artifact to PocketBase
                    │
                    ▼
     update gpx_files summary + index
                    │
                    ▼
Client loads track detail on demand
GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N
```

This flow shows how GPX files move from upload through enrichment to artifact storage and finally to per-track profile loading in the UI.

---

## High-level enrichment flow

1. **Upload GPX** → `gpx_files` record created.
2. **Enrich** (`POST /api/gpx/enrich`): **sync** for small jobs (same request) or **async worker** for large jobs (files over ~15k points or 50 tracks are rerouted to async). Both paths use the **same artifact-backed storage model**.
3. **Worker or sync path**: Enriched tracks are streamed to a **temp NDJSON file** (one JSON object per track), then the artifact file is **streamed to PocketBase** (`enrichment_artifacts`).
4. **After artifact success**: `gpx_files` is updated with **summary only** (`enrichedTracksSummary`, `hasEnrichmentArtifact`, `enrichmentArtifactIndex`). Inline `enrichedTracksJson` is not used for artifact-backed runs (cleared).
5. **UI**: List/filter/selection use summary data. **Charts** need per-track profile data: the client requests **one track’s slice on demand** via `GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N`. The browser never talks to PocketBase directly; all requests go through the app (same-origin).

---

## GPX enrichment pipeline

- **Entry**: `POST /api/gpx/enrich`. **Sync vs async**: Sync enrichment is used only for small files. Files exceeding approximately **15,000 points** or **50 tracks** (code constants `SYNC_MAX_POINTS`, `SYNC_MAX_TRACKS`) are **automatically rerouted to async** worker processing. The worker is the main production path for large enrichments. Async: web creates the job and returns `jobId`; a **separate worker process** (`pnpm run enrichment-worker`) polls for claimable jobs and runs `runEnrichmentJob`.
- **Parsing**: Server-side `extractTracks()` (in `lib/dem/gpx-extract`) parses GPX XML: per `<trk>`/`<rte>`, collects `<trkpt>`/`<rtept>` with lat, lon, and optional `<ele>`. **Parser behavior**: standard `getElementsByTagName("ele")` (and `"name"`) first; only when that returns no element does the code fall back to **local-name matching** (so namespaced GPX 1.1 e.g. Strava works). **Geometry**: GPX lat/lon is always authoritative; DEM affects only elevation.
- **Elevation source priority**: (1) **GPX `<ele>`** — when present and valid. (2) **DEM sampling** — only when GPX elevation is missing or invalid and `DEM_BASE_PATH` is set. (3) **Missing** — stats aggregate over valid points only. When `DEM_BASE_PATH` is unset, **GPX-only enrichment** (no DEM tile reads).
- **Per-track flow**: Each track enriched separately (resampling, distance, DEM/GPX elevation, smoothing, stats, profile). **Duplicate / zero-distance**: Segment length for cumulative distance; stats skip zero/tiny segments; curviness uses collapsed duplicate points.

### Enrichment storage model (artifact-backed)

- **`gpx_files`** stores **lightweight summaries only**: `enrichedTracksSummary` (per-track stats, no profile points), `hasEnrichmentArtifact`, and `enrichmentArtifactIndex`. **Full detail is not stored on the file record.** Inline `enrichedTracksJson` is **no longer the primary path**; it is **cleared** when artifact-backed enrichment is used.
- **`enrichment_artifacts`** holds the **full detail**: one record per GPX file, with an **NDJSON** file; **each line represents exactly one track**. **`enrichmentArtifactIndex`** on `gpx_files` contains **`{ trackIndex, start, length }`** byte offsets into that file; the API reads a slice using this index and returns **one track’s slice only**. When the file backend supports HTTP Range requests, only that byte range is fetched; otherwise the server fetches the artifact and slices it in memory.
- **Write path (sync and async)**: Same model for both. Enriched tracks are **streamed to a temp NDJSON file**; the artifact file is **streamed to PocketBase**. **`gpx_files` is updated only after artifact persistence succeeds** (keeps summary and artifact in sync).

### Enrichment read path

- **List, filter, selection**: Use **summary data only** (`GET /api/gpx/files` → `enrichedTracksSummary`, `hasEnrichmentArtifact`). No full-artifact fetch; **no path in the current architecture returns the entire artifact**.
- **Chart / profile detail**: Requires **per-track artifact fetch**. When `hasEnrichmentArtifact` is true, the client requests **`GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N`** for the **selected track only** (one track’s slice on demand). The **browser never talks to PocketBase directly**; the Next.js API fetches the slice from PocketBase and returns it. The client parses the JSON and merges into local state. If the request fails or parse fails, the UI shows **“Elevation profile not available for this track”** — commonly because: **missing `hasEnrichmentArtifact`** (e.g. list not refetched after enrichment), **failed artifact request** (4xx/5xx, network), **failed parse**, or **detail not yet loaded** (still loading). Bounded retry applies after failure.

---

## Progress / cancel model

- **Enrichment jobs** are stored in PocketBase (`enrichment_jobs`): one record per job, keyed by `jobId`, linked to `recordId` (GPX file) and `userId` (owner). Progress and cancel state are **PocketBase-backed**; no in-memory store.
- **Progress**: The **enrichment worker** (not the web app) calls `updateJobProgress()` at a throttled cadence. Clients poll **`GET /api/gpx/enrichment-progress?jobId=...`**; the API returns data from the job record; access is restricted to the job owner (`userId`).
- **Cancel**: Client calls **`POST /api/gpx/enrichment-cancel`** with `recordId`. Server verifies the GPX record is owned by the current user, then marks the job’s status as `cancelled`. The worker’s `runEnrichmentJob` checks `isCancelled()` periodically and exits cleanly.
- **Resume**: The worker polls for claimable/incomplete jobs and runs `runEnrichmentJob` for each; the web app never runs or resumes enrichment.

---

## Chart / map interaction

- **Three profiles** (elevation, curviness, grade) share a common hover index and distance range (zoom). They depend on **per-track detail** from the enrichment-artifact API. If the track slice has not loaded or load failed, the panel shows “Loading profile…” or “Elevation profile not available for this track.”
- **Map**: For the selected track, a marker or highlight follows the hovered profile index (profile points or track geometry). Chart zoom updates the shared range; the map can highlight the segment.
- **Coordinates**: Always from GPX (profile points carry lat/lng from enrichment; track geometry from GPX or enriched GeoJSON).

---

## Filtering system

- **Track-level filters** (not file-level): average grade (%), maximum grade (%), curviness (°/mi), average elevation (ft), maximum elevation (ft). Stored in component state as min/max per metric.
- **Average elevation** is the mean of valid elevation samples computed during enrichment (per-track summary). **Maximum elevation** comes from the track summary (existing per-track max). Both use feet in the UI.
- **Data bounds**: From the set of tracks in the currently **selected** GPX files; each filter’s min/max is clamped to that data range. Elevation bounds are computed only from tracks with valid elevation data (`validCount > 0`).
- **RangeFilter**: Dual-handle range slider (min/max); commits on pointer release; used for each of the five metrics in **TrackFilters**.
- **Visibility**: A track is visible if it falls within all filter ranges (and is in the selected files). Tracks **without valid elevation data** (`validCount === 0`) are excluded when any elevation filter is active (narrowed from full range); they remain visible when elevation filters are at full range. `visibleTrackKeys` is the set of `fileId-trackIndex` that pass; the map draws only those polylines; the file list / detail view reflect the same selection.

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

**Where to look first:** Worker logs (`[DEM]`, `[enrichment-artifact]`), browser Network tab (same-origin only; no direct PocketBase), and console (`[MapView]`).

- **Successful enrichment but missing profiles in UI**: (1) Confirm the file list includes `hasEnrichmentArtifact: true` — refetch after job complete or refresh. (2) In Network tab, confirm a request to `.../enrichment-artifact?trackIndex=...` for the selected track (not only `.../file`). If the artifact request never appears, client state likely lacks `hasEnrichmentArtifact` (`gpxRecordToDisplay` in `lib/gpx/files.ts` must pass it through). (3) If the request returns 4xx/5xx or parse fails, see below.
- **Artifact persistence failures**: After a job completes, the worker uploads the NDJSON artifact to `enrichment_artifacts` and then updates `gpx_files` with `hasEnrichmentArtifact`, `enrichmentArtifactIndex`, and `enrichedTracksSummary`. **Logs to check:** `[DEM] Artifact persisted`, `[DEM] Enrichment results saved`, `[enrichment-artifact] upload complete`. If upload fails, `gpx_files` is not updated (consistent state). Check PocketBase: artifact record exists and file record has the three fields.
- **Artifact slice API failures**: `GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N` requires `enrichmentArtifactIndex` on the record and the artifact file to exist. **API behavior:** The route uses the index to request **only that track’s bytes**. When the upstream PocketBase file backend supports **HTTP Range requests**, the API sends a Range header and only that byte range is fetched; if the backend returns 200 instead of 206 or the response length is wrong, the server fetches the full artifact and slices it in memory (logged once: `[enrichment-artifact] Range requests not supported by backend` or `Range response length mismatch`). 4xx/5xx or missing index → wrong record state or missing migrations.
- **Missing `hasEnrichmentArtifact`**: List API builds display records via `gpxRecordToDisplay`; that function must add `hasEnrichmentArtifact: true` when the PocketBase record has it. If the list was not refetched after enrichment, the client still has the old file object.
- **Parse failures**: Client parses the slice response as JSON. Console: `[MapView] Per-track artifact parse failed`. Failed loads are retried after a cooldown. Verify response body is valid JSON for one track object.
- **Worker / job issues**: Worker runs one job at a time per process. Logs: `[DEM] Enrichment worker loop started`, `[DEM] Worker claimed job`, `[DEM] Job completed`. If jobs stay pending, worker may not be running or not reaching PocketBase. Progress: poll `GET /api/gpx/enrichment-progress?jobId=...`; cancel: `POST /api/gpx/enrichment-cancel`.
