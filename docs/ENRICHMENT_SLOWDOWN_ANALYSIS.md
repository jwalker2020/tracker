# Enrichment Job Slowness: Analysis and Recommendations

**Scope:** Analysis only. No code changes. Goal: make the web app more performant and responsive while enrichment jobs are active.

**Current architecture (as of worker rollout):** Async enrichment runs in a **separate worker process** (`pnpm run enrichment-worker`). The web app only creates jobs and returns `jobId`; the worker polls for claimable jobs and runs `runEnrichmentJob`. So the web app no longer runs enrichment in-process; the causes and recommendations below still apply if the worker shares a machine with the web app or if considering further optimizations.

---

## 1. Most Likely Causes of the Slowdown

### 1.1 Enrichment running in the same Next.js process (HIGH) — *addressed by worker*

- **Previously:** `runEnrichmentInBackground` was invoked from `POST /api/gpx/enrich` and from `instrumentation.ts` on startup, in the same Node.js process as the Next.js server.
- **Now:** Enrichment runs in a separate worker process (`runEnrichmentJob` in `workerLoop.ts`). The web app no longer runs or resumes jobs. If the worker and web share one machine, CPU from the worker can still affect the host; otherwise this cause is addressed.

### 1.2 API route contention (HIGH)

- **Progress reads:** `GET /api/gpx/enrichment-progress` is polled every **1 second** by `EnrichmentProgressIcon` (in `GpxFileList`) per active job, and every **5 seconds** by `GpxUploadForm` when `enrichmentJobId` is set. Each request: `getCurrentUserId(request)` (cookie parse + PocketBase auth load) and `getJobByJobId(pb, jobId)` (PocketBase `getList` on `enrichment_jobs`).
- **Progress writes:** The worker’s `runEnrichmentJob` calls `updateJobProgress` every **1.5 seconds** (throttled in `runEnrichmentJob.ts`: `PROGRESS_WRITE_THROTTLE_MS = 1_500`). Each write is a PocketBase `update` on the checkpoint record.
- **Effect:** Progress reads (web) and progress writes (worker) no longer share the same process. They still share PocketBase; under load, progress requests can queue if PocketBase or the network is busy.

### 1.3 Progress polling frequency (MEDIUM)

- **EnrichmentProgressIcon:** `POLL_INTERVAL_MS = 1000` in `GpxFileList.tsx`. One active job ⇒ one request per second to `GET /api/gpx/enrichment-progress`.
- **GpxUploadForm:** `POLL_INTERVAL_MS = 5000` when waiting for the just-uploaded file’s job.
- **Effect:** The 1 s interval for the icon is the main source of repeated traffic. It keeps the UI “live” but multiplies the number of auth + PB read operations and increases contention.

### 1.4 Broad React rerenders (LOW–MEDIUM)

- **GpxView** holds `files`, `orderedFileIds`, `selectedIds`, `activeEnrichmentByFileId`, `filterState`, etc. Progress state lives **inside** `EnrichmentProgressIcon` (local `useState(progress)`). So progress updates do **not** by themselves cause `GpxView` or `GpxFileList` to rerender; only the list item that contains the icon rerenders every ~1 s.
- **MapView** receives `files` (selectedFiles), `visibleTrackKeys`, etc. Those props change only when the user refetches, reorders, or changes selection/filters—not on each progress tick. So progress is **not** directly driving map or chart rerenders.
- **Caveat:** When `refetch()` runs (e.g. after enrichment completes), `setFiles(list)` replaces the whole file list. That triggers recomputation of `dataBounds`, `visibleTrackKeys`, and `selectedFiles`, and MapView rerenders with new props. So the **post-completion refetch** is one heavy update, but it’s a single event, not continuous during the job.

### 1.5 Map / chart rerenders (LOW)

- Map and chart rerender when their **props** change (e.g. `files`, `visibleTrackKeys`, `selectedTrack`). Progress does not change those props. So **progress updates are not the direct cause** of map or chart rerenders during enrichment.
- **GpxOverlay** runs an effect that depends on `[map, baseUrl, files, visibleTrackKeys, setSelectedTrack]`. When `files` or `visibleTrackKeys` change (e.g. after refetch or filter change), it re-fetches geometry via `getDisplayGeometry(rec, baseUrl)` for **every** selected file. If a file has no `enrichedGeoJson`, that triggers a **client-side fetch** to PocketBase’s file URL for the raw GPX. So filter/selection changes can cause repeated geometry fetches for non-enriched files, which can add latency but is not tied to the 1 s progress tick.

### 1.6 Repeated large payload fetches (MEDIUM)

- **GET /api/gpx/files:** Returns the **full** file list with `gpxRecordToDisplay(record)` for each record. That includes parsing `enrichedTracksJson` (and per-track `elevationProfileJson`) for every file. For many or large tracks, the response is a large JSON payload and the server does N large `JSON.parse` operations.
- **When:** Initial page load (RSC: server fetches list and passes `initialFiles` to `GpxView`) and on `refetch()` (e.g. after upload, after enrichment complete, after delete). Not on a timer during enrichment.
- **Effect:** The big cost is at **load** and at **refetch after completion**. During enrichment, if the user does not refetch, there are no repeated large file-list fetches. But any refetch (or initial load) with many/large files will be expensive and can make the app feel sluggish.

### 1.7 Repeated PocketBase reads/writes (HIGH)

- **During enrichment:**  
  - Runner: `getOne` (gpx_files), fetch file URL, then every 1.5 s `updateJobProgress` (enrichment_jobs update), plus `getCheckpointByRecordId` for `isCancelled()` checks, and at the end one large `update` on gpx_files with `enrichedTracksJson`.  
  - UI: ~1/s `getJobByJobId` (enrichment_jobs getList) from progress API, plus auth cookie load.  
- **Effect:** Same Node process and same PocketBase instance handle both the heavy write pattern and the progress reads. Writes can block or delay reads; reads add load. Together with (1.1) and (1.2), this is a major contributor.

### 1.8 Large JSON serialization/deserialization (MEDIUM)

- **Server:** `gpxRecordToDisplay` parses `enrichedTracksJson` (and nested `elevationProfileJson`) for **every** file when building the list. The worker’s `runEnrichmentJob` final update does `JSON.stringify(enrichedTracks)` (potentially millions of points) and sends it in one PocketBase `update`. Code already logs when `enrichedTracksJson.length > 9_000_000`.
- **Client:** Receives the full list JSON; React and Leaflet then work with the resulting objects. No per-progress-tick large parse; the cost is concentrated in the file-list response and the final gpx_files update.
- **Effect:** Large serialization/deserialization adds to the cost of refetch and of the final save, and can briefly tie up the event loop and PocketBase.

---

## 2. Highest-Impact Changes (Prioritized)

1. **Move enrichment off the Next.js event loop** (e.g. worker thread, separate process, or job queue). This directly addresses the main cause: CPU and I/O from enrichment no longer block API and UI responsiveness.
2. **Reduce progress polling frequency** (e.g. 1 s → 2–3 s for the icon, or adaptive backoff). Fewer progress requests reduce contention and PocketBase load with minimal impact on perceived “liveness.”
3. **Throttle or batch progress writes** (e.g. increase `PROGRESS_WRITE_THROTTLE_MS` or write only when percent/phase changes meaningfully). Fewer writes reduce contention and DB load.
4. **Avoid returning full `enrichedTracksJson` (and heavy profile JSON) in the file list API** when not needed (e.g. list-only endpoint or lazy-load details). Reduces payload size and parse cost on load/refetch.
5. **Isolate progress state** so that only the progress UI (e.g. icon + optional small panel) rerenders on progress updates, and ensure map/chart receive stable props (e.g. memoized `selectedFiles` / callbacks). Current design is already mostly isolated; small refinements can prevent any accidental broad rerenders.

---

## 3. Recommendations by Category

### 3.1 Architecture changes

- **Run enrichment in a separate context:** **Implemented.** A separate worker process (`pnpm run enrichment-worker`) polls for claimable jobs and runs `runEnrichmentJob`. The Next.js app only creates checkpoint records and returns `jobId`; the worker does DEM work and progress updates. This removes enrichment from the web app event loop.
- **Optional job queue:** Introduce a lightweight queue (e.g. in-memory + persistence in PostgreSQL/Redis) so that only one worker (or a bounded pool) runs enrichment. Reduces risk of multiple heavy jobs on one machine and makes progress writes more predictable.
- **Keep progress and file list APIs lightweight:** Progress API should only read one small record (job status + progress fields). File list API should either return list-only (no enrichedTracks) or a separate “file details” endpoint for map/chart data when a file is selected.

### 3.2 Backend / API changes

- **Increase progress write throttle:** In `runEnrichmentJob.ts`, raise `PROGRESS_WRITE_THROTTLE_MS` from 1.5 s to 2.5–3 s, or write only when `overallPercentComplete` or `currentPhase` changes by a meaningful delta (e.g. ≥ 2–3%). Reduces write frequency without materially affecting UX.
- **Lightweight progress endpoint:** Ensure `GET /api/gpx/enrichment-progress` does a single, minimal read (e.g. by jobId only, select only needed fields). Already close; avoid any extra list or full-record fetch.
- **List endpoint without heavy JSON:** Add a “list” variant of `GET /api/gpx/files` that returns only fields needed for the sidebar (id, name, color, sortOrder, activeEnrichmentJobId, maybe bounds/center). Load full `enrichedTracks` (or geometry) only when needed (e.g. when file is selected or when opening map). Reduces initial load and refetch cost.
- **Avoid parsing enrichedTracksJson on every list request:** If the list response must include per-file summary, consider storing a small “summary” field (e.g. track count, total distance) and only parse full JSON when serving a single file or map data.

### 3.3 Frontend rendering / state changes

- **Keep progress state local to progress UI:** Progress is already in `EnrichmentProgressIcon`; ensure no parent state (e.g. in GpxView) is updated on every progress tick. Avoid passing progress into shared state that feeds map/chart.
- **Stable references for map/chart props:** Ensure `selectedFiles`, `visibleTrackKeys`, and callbacks passed to MapView are memoized (e.g. `useMemo` / `useCallback`) so that unrelated parent updates (e.g. error message, refetching flag) do not force MapView to rerender. GpxView already uses several useMemos; audit so that `files` and derived values only change when list/selection/filter actually change.
- **Memoize list items:** Consider `React.memo` on the file list row component (or the component that wraps the icon) so that only the row with the active job rerenders when that row’s progress updates. Reduces work in the list during polling.
- **Lazy geometry:** When `getDisplayGeometry` is used (MapView), cache result per `(fileId, file.updated)` or equivalent so that repeated effect runs (e.g. from filter changes) do not re-fetch the same GPX file from the server. Especially helpful for files without `enrichedGeoJson`.

### 3.4 Polling / progress changes

- **Increase EnrichmentProgressIcon poll interval:** Change `POLL_INTERVAL_MS` from 1000 to 2000 or 2500. Progress bar still feels responsive; roughly halves progress API traffic.
- **Unify pollers:** Only one component should poll for a given jobId (e.g. icon in the list). GpxUploadForm’s 5 s poll is redundant if the list icon is always visible for the same job; consider removing the upload-form poll when the file list already shows the job, or use a single shared interval.
- **Exponential backoff when “saving” or near completion:** When `currentPhase === "saving"` or `overallPercentComplete >= 95`, poll less often (e.g. 3–5 s). Reduces load during the final phase when the bar moves slowly anyway.
- **Optional: Server-Sent Events or WebSocket for progress:** Replace polling with a single SSE/WS connection that pushes progress for the active job(s). Removes N polling requests per second and can improve perceived responsiveness; requires a small backend change and connection handling.

---

## 4. Frontend Analysis

### 4.1 Components that could cause broad rerenders

- **GpxView:** Holds most of the page state. It does **not** receive progress as a prop; progress is local to `EnrichmentProgressIcon`. So progress ticks do not cause GpxView to rerender. Rerenders happen on `setFiles`, `setSelectedIds`, `setFilterState`, `setActiveEnrichmentByFileId`, etc.
- **GpxFileList:** Receives `files`, `orderedFileIds`, `selectedIds`, `onToggle`, `onReorder`, `activeEnrichmentJobByFileId`. When `EnrichmentProgressIcon` (child) calls `setProgress`, only that icon’s subtree rerenders—so the **list item** containing the icon rerenders. With one active job, that’s one list item per second. Acceptable but can be reduced with a longer poll interval or `React.memo` on the row.
- **MapView:** Receives `files`, `visibleTrackKeys`, etc. These change only when selection/filter/files change, not on progress. So **map and chart do not rerender from progress updates** in the current design.

### 4.2 Where memoization or state isolation would help

- **File list row:** Wrap each list row (or the component that includes the checkbox, label, and icon) in `React.memo` with a custom compare that ignores the progress snapshot (or pass `jobId` and keep progress inside the row). Then only the row with the active job rerenders when its progress updates.
- **GpxView → MapView props:** Ensure `selectedFiles`, `visibleTrackKeys`, and any inline callbacks are stable (e.g. `useMemo` for derived data, `useCallback` for handlers). This prevents unnecessary MapView rerenders when other GpxView state (e.g. error, refetching) changes.
- **Geometry:** Cache `getDisplayGeometry(rec, baseUrl)` result keyed by `rec.id` and a version (e.g. `rec.updated` or hash of `rec.enrichedGeoJson`) so that GpxOverlay’s effect doesn’t re-fetch the same file when only `visibleTrackKeys` or an unrelated prop changes.

### 4.3 Whether progress updates cause unnecessary map/chart/file-list rerenders

- **Map/chart:** No. Progress is not in the props of MapView; map and chart rerender only when `files`, `visibleTrackKeys`, or `selectedTrack` change. Progress does not change those.
- **File list:** Only the **one list item** that contains the active job’s icon rerenders every poll (e.g. every 1 s). The rest of the list and the parent GpxFileList do not get new props from progress. So progress causes minimal, localized list rerenders. Reducing poll frequency or memoizing the row would reduce this further.

---

## 5. Backend Analysis

### 5.1 Is enrichment in-process the main bottleneck?

- **Yes.** The enrichment loop is CPU- and I/O-intensive and runs in the same process as the Next.js server. While it runs, the event loop is busy, so:
  - Progress API responses are delayed.
  - Any other API (e.g. file list, reorder, cancel) can be delayed.
  - Server components (e.g. on navigation) can be delayed.
- Moving enrichment to a worker thread or separate process is the most effective way to restore responsiveness.

### 5.2 Are progress writes too frequent?

- **Somewhat.** Writes are throttled to 1.5 s. For long runs (tens of thousands of points), that’s still many writes. Increasing to 2.5–3 s or writing only on meaningful percent/phase changes would reduce load with little impact on the progress bar. The progress **read** (1/s from the icon) is likely more impactful than the write frequency, but both contribute to contention.

### 5.3 Do large record updates or file fetches contribute?

- **Yes, but in specific moments:**
  - **Final gpx_files update:** One large `update` with `enrichedTracksJson` (and related fields) can be multi-megabyte and can block the process and PocketBase briefly. It happens once per job at the end.
  - **File fetches:** The runner fetches the GPX file once at the start from PocketBase’s file URL. The map fetches geometry (GPX or enrichedGeoJson) when it needs to draw; if the user changes selection/filter often, that can trigger repeated client-side fetches for files without `enrichedGeoJson`. So large updates and repeated file fetches contribute, but the dominant ongoing cost during enrichment is the **in-process CPU + progress I/O**, not the one-off final write or occasional geometry fetch.

---

## 6. Phased Plan

### Phase 1: Immediate, low-risk improvements

- **Increase EnrichmentProgressIcon poll interval** from 1 s to 2–3 s. No backend change; fewer progress API and PocketBase read calls.
- **Increase PROGRESS_WRITE_THROTTLE_MS** from 1.5 s to 2.5 s (or 3 s). Fewer progress writes; progress bar still smooth enough.
- **Ensure progress API is minimal:** Single read by jobId, return only needed fields. No extra list or full-record fetches.

**Impact:** Less contention and load; app should feel somewhat more responsive during enrichment with minimal risk.

### Phase 2: Medium-effort improvements

- **Memoize file list row** (or wrap in `React.memo`) so only the row with the active job rerenders on progress. Reduces React work during polling.
- **Cache getDisplayGeometry** per file (e.g. by id + updated or enrichedGeoJson presence) so filter/selection changes don’t re-fetch the same GPX. Reduces redundant network and parse.
- **Lightweight file list API:** New endpoint or query param that returns list without full `enrichedTracksJson` / full profile JSON; load full data only when needed (e.g. when file is selected for map). Reduces payload and parse cost on load and refetch.
- **Single poller per job:** Remove or relax GpxUploadForm’s 5 s poll when the same job is already shown in the file list (e.g. rely on list icon only). Avoids duplicate progress requests for the same job.

### Phase 3: Larger architectural improvements

- **Run enrichment in a worker thread or separate process:** **Done.** The enrichment worker (`workerLoop.ts` + `runEnrichmentJob.ts`) runs as a separate process; Next.js only creates jobs and serves progress reads. This is the main architectural fix for “app slow during enrichment.”
- **Optional job queue:** Use a simple queue (e.g. DB-backed or Redis) so at most one (or a fixed number of) enrichment job(s) run per instance; progress API and other routes stay responsive.
- **Optional SSE/WebSocket for progress:** One connection that pushes progress for active job(s). Removes polling and can improve perceived latency.

---

## 7. Deliverable Summary

### Likely root causes

1. **Enrichment running in the same Next.js process** — CPU and I/O block the event loop and delay all API and UI.
2. **API route contention** — Progress reads (~1/s) and progress writes (~1/1.5 s) compete with the enrichment loop and with each other on the same process and PocketBase.
3. **Repeated PocketBase reads/writes** — Progress polling and throttled progress updates add constant load.
4. **Large payloads and JSON** — File list returns full enrichedTracks (and profiles) for every file on load/refetch; final job update writes a large enrichedTracksJson. These add cost at specific times rather than every second.

### Prioritized recommendations

1. **Move enrichment off the main process** (worker or separate process) — highest impact.
2. **Reduce progress polling frequency** (e.g. 1 s → 2–3 s for the icon).
3. **Throttle or slim progress writes** (longer throttle or write only on meaningful change).
4. **Lightweight file list** (list without full enrichedTracks; load details when needed).
5. **Isolate and memoize** progress UI and map/chart props so only progress UI rerenders on progress.

### Best immediate quick wins

- **Increase EnrichmentProgressIcon `POLL_INTERVAL_MS` to 2000–2500 ms.** Cuts progress API traffic roughly in half with no backend change.
- **Increase `PROGRESS_WRITE_THROTTLE_MS` to 2500–3000 ms.** Cuts progress write frequency with minimal impact on progress bar smoothness.

Together these reduce contention and load with very low risk and small code surface.

### Best long-term architecture changes

- **Run enrichment in a worker thread or separate process** so the Next.js event loop is not blocked. This directly addresses the main cause of slowness.
- **Lightweight list API + lazy full data** so initial load and refetch are fast; map/chart load heavy data only when needed.
- **Optional:** Single progress channel (SSE/WS) instead of polling; optional job queue for bounded concurrency.

### Smallest practical step to improve responsiveness right now

- **Change `POLL_INTERVAL_MS` in `GpxFileList.tsx` from 1000 to 2500** (and optionally the same or 5000 in `GpxUploadForm.tsx` for consistency). One constant change; fewer progress requests and less contention during enrichment, with progress still updating every 2.5 s.
