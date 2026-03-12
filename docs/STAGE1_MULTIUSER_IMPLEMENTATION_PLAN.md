# Stage 1: Multi-User Safety & Shared Progress — Implementation Plan

**Constraints:** Single server only; no external queue. Async enrichment runs in a **separate worker process** (`pnpm run enrichment-worker`); the web app only creates jobs and returns `jobId`. Goal: correctness and multi-user safety first. **No code changes in this document — analysis and planning only.**

---

## 1. User isolation

### 1.1 Auth model to add or use

- **Use PocketBase built-in auth.** The app already uses PocketBase; the `users` collection and auth APIs are built in.
- **Server-side auth:** Next.js API routes must identify the current user on each request. Recommended approach:
  - Client sends auth token on every request (e.g. `Authorization: Bearer <token>` or cookie set by PocketBase on login).
  - Server helper (e.g. `getCurrentUserId(request)`) that:
    - Reads token/cookie from the request.
    - Validates with PocketBase (e.g. `pb.authStore.loadFromCookie(request.headers.get('cookie') ?? '')` or a dedicated auth check API).
    - Returns `userId` (string) or `null` if unauthenticated.
- **Routes that require auth:** All GPX and enrichment APIs that read or mutate user data should require an authenticated user for Stage 1 (return 401 if no user). Optional: allow anonymous with a single “guest” user id for backward compatibility during rollout.

### 1.2 How `gpx_files` is associated with a user

- **Add a dedicated user field.** The schema already has optional `uploadedBy` (text); for clear ownership and rules, add a **relation** field to the PocketBase `users` collection (e.g. `user`, type relation, single, required: false for migration).
- **Backfill:** Existing records have no user; treat as “legacy” and either assign to a default user or hide from multi-user list until backfilled. New uploads must set `user` (or `uploadedBy` as user id) from the authenticated user.
- **Upload path:** Today upload is client → PocketBase directly (`GpxUploadForm` calls `pb.collection("gpx_files").create(formData)`). For multi-user safety, either:
  - **Option A (recommended):** Add a server upload endpoint (e.g. `POST /api/gpx/upload`) that accepts the file/name/color etc., sets `user` from `getCurrentUserId(request)`, and creates the record via server-side PocketBase. Client calls this endpoint instead of PocketBase directly.
  - **Option B:** Keep client-side create but require PocketBase **create rule** on `gpx_files` (e.g. `user = @request.auth.id`) and have the client send auth; then the client must set `user = pb.authStore.model?.id` when creating. Option B avoids a server upload but relies on client and PB rules; Option A gives one place to enforce ownership.

### 1.3 How `enrichment_jobs` is associated with a user

- **Store `userId` on each job.** Add a field on `enrichment_jobs` (e.g. `userId`, text, or relation to `users`). When creating a checkpoint/job in the enrich route, set `userId` from the authenticated user (same user that owns the GPX record). This allows:
  - Progress API to verify ownership by `jobId` + `userId`.
  - Cancel and other flows to ensure the requester owns the record (and thus the job).

### 1.4 Which routes/services must enforce ownership

| Route / service | Ownership check |
|-----------------|-----------------|
| **Upload** (new `POST /api/gpx/upload` or client create) | Server sets user from auth; no “check” other than auth. |
| **GET /api/gpx/files** | Filter list by current user: only return `gpx_files` where `user = currentUserId`. |
| **POST /api/gpx/enrich** | Before starting job: load GPX record by id, verify `record.user === currentUserId` (or equivalent). Reject 403 if not owner. |
| **GET /api/gpx/enrichment-progress** | Resolve job by `jobId`, then verify `job.userId === currentUserId` (or via job.recordId → gpx_files.user). Return 404 if not found or not owner. |
| **POST /api/gpx/enrichment-cancel** | Resolve job/record by `recordId`; verify the GPX record belongs to current user; then mark cancelled. Reject 403 if not owner. |
| **Delete GPX** (client today: `pb.collection("gpx_files").delete(id)` + cancel API) | Prefer server delete: e.g. `DELETE /api/gpx/files/[id]` that verifies ownership then deletes. Cancel API already takes recordId; enforce ownership there so only owner can cancel. |
| **Checkpoint helpers** (internal) | Called from enrich route after ownership was already checked; no extra check needed if job is created with correct `userId`. |
| **Reorder** (client: `pb.collection("gpx_files").update(id, { sortOrder })`) | Either enforce via PocketBase update rule (`user = @request.auth.id`) or move to server endpoint that checks ownership then updates. |

**Files that need ownership logic:**

- New or updated: auth helper (e.g. `apps/web/src/lib/auth.ts` or under `api`) to get `currentUserId(request)`.
- `apps/web/src/app/api/gpx/files/route.ts` — GET: filter by user.
- `apps/web/src/app/api/gpx/enrich/route.ts` — POST: verify GPX owner, set `userId` on checkpoint.
- `apps/web/src/app/api/gpx/enrichment-progress/route.ts` — GET: resolve job, verify owner.
- `apps/web/src/app/api/gpx/enrichment-cancel/route.ts` — POST: verify GPX owner before cancelling.
- New: `apps/web/src/app/api/gpx/upload/route.ts` (if Option A) and/or `apps/web/src/app/api/gpx/files/[id]/route.ts` for GET/DELETE with ownership.

---

## 2. Shared progress / job state

### 2.1 Replacing the in-memory store and `recordIdToJobId` map

- **Remove:** `apps/web/src/app/api/gpx/enrichment-progress/store.ts` in-memory `globalThis` store and `recordIdToJobId` map.
- **Replace with:** PocketBase `enrichment_jobs` as the single source of truth for both checkpoint/resume data and progress display. Every progress update (`setProgress`-equivalent) becomes an update to the corresponding `enrichment_jobs` record (by job id or by checkpoint record id). The “recordId → jobId” lookup is already implemented: `getCheckpointByRecordId(pb, recordId)` returns the job record, which contains `jobId`. So no separate in-memory map is needed.

### 2.2 Reuse `enrichment_jobs` vs separate progress collection

- **Reuse `enrichment_jobs`.** One collection is enough for Stage 1: it already has job identity, record identity, status, processed/total points, timestamps, and cancellation (status = cancelled). Adding progress-display fields (phase, percent) to the same record keeps progress and checkpoint in sync and avoids cross-table consistency issues.

### 2.3 Fields to store (job, record, user, status, phase, percent, points, timestamps, cancellation)

**Already in `enrichment_jobs` (keep):**

- **Job identity:** `jobId`, `recordId` (and record id is the PocketBase record id for the job row itself).
- **Status:** `status` (pending | running | completed | failed | resumable | cancelled).
- **Points:** `totalPoints`, `processedPoints`, `nextPointIndex`, `chunkSize`.
- **Timestamps:** `startedAt`, `updatedAt`, `lastHeartbeatAt`.
- **Resume/checkpoint:** `minElevationM`, `maxElevationM`, `totalAscentM`, `totalDescentM`, `distanceM`, `priorElevationM`, `validCount`, `profileJson`, `errorMessage`.

**Add for Stage 1:**

- **User identity:** `userId` (text, required: false for migration) — PocketBase user id of the owner.
- **Progress display (for progress API and UI):**  
  - `overallPercentComplete` (number, 0–100)  
  - `currentPhase` (text, e.g. "setup" | "parsing" | "enrichment" | "saving" | "completed")  
  - `currentPhasePercent` (number, 0–100)  
  - `error` (text, optional) — last error message for progress/UI (can reuse or alias `errorMessage` if preferred).

Optional but useful for UI: `currentTrackIndex`, `totalTracks` (numbers). These can be added to the same record.

**Cancellation:** Already represented by `status = "cancelled"`. No new field needed.

**Summary:** One row per job in `enrichment_jobs` holds both checkpoint data and live progress. The enrichment loop (or a thin progress “writer” used by the loop) updates this row on every progress tick (or on a short throttle, e.g. every 1–2 seconds, to limit write volume).

---

## 3. Route-by-route impact

### 3.1 Upload flow

- **Current:** Client `GpxUploadForm.tsx` calls `pb.collection("gpx_files").create(formData)` then POST `/api/gpx/enrich` with `{ id: record.id, async: true }`.
- **Change:**  
  - **If server upload (recommended):** Add `POST /api/gpx/upload` (e.g. `apps/web/src/app/api/gpx/upload/route.ts`) that: reads auth → gets `currentUserId`, parses multipart/form (name, file, color, etc.), creates `gpx_files` with `user` set, returns new record id. Client calls this instead of PocketBase create.  
  - **If client create:** Ensure client is authenticated and sets `user` (or `uploadedBy`) to current user id; add PocketBase create rule on `gpx_files` so only own records can be created.  
- **Files:** `apps/web/src/components/gpx/GpxUploadForm.tsx` (switch to fetch `/api/gpx/upload` or set `user` + auth); new `apps/web/src/app/api/gpx/upload/route.ts` if Option A.

### 3.2 GPX list API

- **Current:** `GET /api/gpx/files` → `getGpxFilesList()` in `apps/web/src/lib/gpx/files.ts` → `pb.collection("gpx_files").getList(1, 500)` with no filter.
- **Change:** Require auth. Get `currentUserId` in the route; pass it to the list function. In `getGpxFilesList(pb, userId)` (or equivalent), filter by `user = userId`. Return 401 if unauthenticated.
- **Files:** `apps/web/src/app/api/gpx/files/route.ts` (add auth, pass userId); `apps/web/src/lib/gpx/files.ts` (add optional `userId` and filter in getList).

### 3.3 Enrich API

- **Current:** `apps/web/src/app/api/gpx/enrich/route.ts` — POST body `{ id, async }`. For async: creates or locates checkpoint via `createCheckpointRecord` / `getResumableCheckpoint`, updates progress fields as needed, returns `{ ok: true, jobId, resumed }`. It does **not** run enrichment in-process; a separate worker process polls for claimable jobs and runs `runEnrichmentJob(pb, jobId)` from `apps/web/src/lib/enrichment/runEnrichmentJob.ts`. Progress is read/written via `enrichment_jobs`; the worker uses `updateJobProgress` and checkpoint helpers in `enrichment-checkpoint.ts`.
- **Change (Stage 1):**  
  - Require auth; get `currentUserId`.  
  - Load GPX record by `id`; if not found return 404; if `record.user !== currentUserId` return 403.  
  - When creating checkpoint, pass `userId` into `createCheckpointRecord` and persist it.  
  - No in-memory job store; job identity is the `enrichment_jobs` row (create or get resumable).  
  - Worker already updates progress via `updateJobProgress`; ensure `userId` is on the job so progress API can enforce ownership.  
  - Cancellation is persisted in PocketBase; worker checks status via checkpoint helpers.
- **Files:** `apps/web/src/app/api/gpx/enrich/route.ts` (add auth, ownership check, set `userId` on checkpoint); `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` (add `userId` to create; progress fields and `updateJobProgress` already used by worker).

### 3.4 Progress API

- **Current:** `GET /api/gpx/enrichment-progress?jobId=...` → `apps/web/src/app/api/gpx/enrichment-progress/route.ts` → `getProgress(jobId)` from in-memory store.
- **Change:** Require auth. Get job from PocketBase by `jobId` (e.g. filter `enrichment_jobs` by `jobId`). If no record, return 404. If `job.userId !== currentUserId`, return 404 (or 403). Return JSON with `status`, `overallPercentComplete`, `currentPhase`, `currentPhasePercent`, `processedPoints`, `totalPoints`, `error`, etc., from that record.
- **Files:** `apps/web/src/app/api/gpx/enrichment-progress/route.ts` (replace store with PocketBase fetch by jobId + ownership check). Optionally remove or repurpose `apps/web/src/app/api/gpx/enrichment-progress/store.ts` once no callers remain.

### 3.5 Cancel API

- **Current:** `POST /api/gpx/enrichment-cancel` body `{ recordId }` → `markCheckpointCancelled(pb, recordId)` + `cancelJobForRecord(recordId)` (in-memory).
- **Change:** Require auth. Load GPX record by `recordId`; if not found 404; if `record.user !== currentUserId` return 403. Then call `markCheckpointCancelled(pb, recordId)`. Remove `cancelJobForRecord` (in-memory); cancellation is persisted only in PocketBase. Running job will see `status === "cancelled"` on next `getCheckpointByRecordId` check.
- **Files:** `apps/web/src/app/api/gpx/enrichment-cancel/route.ts` (add auth, ownership check, remove import and use of `cancelJobForRecord`).

### 3.6 Delete GPX flow

- **Current:** `GpxView.tsx` `deleteSelected`: fires POST enrichment-cancel for each id, then `pb.collection("gpx_files").delete(id)` from client.
- **Change:** Prefer server-side delete: add `DELETE /api/gpx/files/[id]` that verifies ownership then deletes the record (and optionally cancels any job for that record). Client calls this instead of `pb.collection(...).delete(id)`. If client still deletes via PocketBase, enforce PocketBase delete rule (e.g. `user = @request.auth.id`) so users can only delete their own files.
- **Files:** `apps/web/src/components/gpx/GpxView.tsx` (call `DELETE /api/gpx/files/${id}` or keep pb delete with rules); new `apps/web/src/app/api/gpx/files/[id]/route.ts` for DELETE (and optionally GET one file with ownership).

### 3.7 Checkpoint / resume logic

- **Current:** `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` — create/getResumableCheckpoint, saveCheckpoint, markCheckpointCompleted/Failed/Cancelled, getCheckpointByRecordId. Enrich route uses these and in-memory progress.
- **Change:**  
  - Add `userId` to `createCheckpointRecord` and store it.  
  - Add progress fields to `saveCheckpoint` (or a separate `updateJobProgress`) so that during enrichment we write `overallPercentComplete`, `currentPhase`, `currentPhasePercent`, and optionally `currentTrackIndex`/`totalTracks` to the same record.  
  - Resumable logic stays the same (filter by recordId and status running/resumable). No changes to `getResumableCheckpoint` signature beyond possibly ensuring it can return the new fields.  
  - All progress reads in the enrich route (e.g. for logging or isCancelled) use PocketBase (getCheckpointByRecordId or get by jobId) instead of in-memory getProgress.
- **Files:** `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` (add userId on create; add progress fields to create and update; optionally add `updateJobProgress`). `apps/web/src/app/api/gpx/enrich/route.ts` (use PB for progress and cancellation only).

---

## 4. Data model changes (PocketBase schema)

### 4.1 `gpx_files`

- **New or updated field for owner:**  
  - Add relation to `users`: field name e.g. `user`, type `relation`, single, collection `users`, required `false` (for backfill).  
  - Or repurpose `uploadedBy` as text storing user id and enforce in app code. Prefer relation for clarity and optional PB rules.
- **Index:** Index on `user` for fast list filtering.

### 4.2 `enrichment_jobs`

- **New fields:**  
  - `userId` (text, required: false) — id of the PocketBase user who owns the GPX record.  
  - `overallPercentComplete` (number, required: false).  
  - `currentPhase` (text, required: false).  
  - `currentPhasePercent` (number, required: false).  
  - `error` (text, required: false) — for progress/UI (or reuse `errorMessage`).  
  - Optional: `currentTrackIndex`, `totalTracks` (number, required: false).
- **Indexes:**  
  - Index on `jobId` (unique if possible) for progress API lookup.  
  - Index on `recordId` + `updatedAt` (or similar) for `getCheckpointByRecordId` and resumable lookup.

### 4.3 Migrations

- One migration: add `user` to `gpx_files` (if not using existing `uploadedBy` as relation); add `userId`, `overallPercentComplete`, `currentPhase`, `currentPhasePercent`, `error` (and optional track fields) to `enrichment_jobs`. Add indexes as above.

---

## 5. Progress and cancellation behavior after Stage 1

### 5.1 Progress lookup without in-memory maps

- Client still calls `GET /api/gpx/enrichment-progress?jobId=...`.  
- Server loads the job from PocketBase by `jobId` (filter `enrichment_jobs` where `jobId = :jobId`).  
- If no row or `job.userId !== currentUserId`, return 404.  
- Response body is built from that row: status, overallPercentComplete, currentPhase, currentPhasePercent, processedPoints, totalPoints, error, etc.  
- No in-memory store; every poll hits PocketBase. Progress is durable and survives restarts.

### 5.2 How cancel finds the correct job

- Client sends `recordId`.  
- Server verifies the GPX record exists and `record.user === currentUserId`; otherwise 403.  
- Server calls `markCheckpointCancelled(pb, recordId)`, which uses `getCheckpointByRecordId(pb, recordId)` to find the job row and sets `status = "cancelled"`.  
- No need for `recordIdToJobId`; the job is found in PocketBase by recordId.

### 5.3 Restart resilience

- After a server restart, there is no in-memory state. All active jobs are represented only in PocketBase with status `running` or `resumable`.  
- Progress API still works: client polls by jobId; server reads the row from PocketBase and returns current progress.  
- Cancellation is already persisted in PocketBase, so a cancel request before restart is visible after restart.  
- Resumable jobs: when the client (or user) calls POST enrich again for the same record, `getResumableCheckpoint` returns the existing row and enrichment can resume from `nextPointIndex`.  
- No “ghost” jobs in memory; no lost progress or cancel state.

### 5.4 Remaining limitations (enrichment still in-process)

- Only one Node process is running enrichment; multiple concurrent jobs share the same event loop and CPU. No isolation between jobs.  
- Progress write throughput: every progress tick updates PocketBase; if ticks are very frequent, consider throttling updates (e.g. at most once per 1–2 seconds) to avoid overloading PocketBase.  
- No horizontal scaling: all jobs run on the same server. Stage 2 (queue + workers) would address that.

---

## 6. Minimal implementation sequence

Order to minimize risk and allow incremental testing:

1. **Schema and migrations**  
   Add `user` (or userId) to `gpx_files`, and `userId` + progress fields to `enrichment_jobs`. Run migrations. No app behavior change yet.

2. **Auth helper**  
   Implement `getCurrentUserId(request)` (or equivalent) using PocketBase auth (cookie/token). Add a minimal login/session flow if the app doesn’t have one, so API routes can require auth.

3. **Ownership on read**  
   - Add auth to GET `/api/gpx/files` and filter by current user.  
   - Backfill or default existing `gpx_files` so they have a user (or exclude from list until backfilled).  
   This gives correct list per user without changing write paths yet.

4. **Progress in PocketBase**  
   - Add `updateJobProgress(pb, ...)` (or extend `saveCheckpoint`) to write progress fields to `enrichment_jobs`.  
   - In enrich route, replace in-memory `setProgress` with this writer; replace `getProgress` (for logging and isCancelled) with reads from PocketBase (by jobId or recordId).  
   - Keep in-memory store temporarily if useful for local logging, but make progress API read from PocketBase only.  
   Then switch progress API to read from PocketBase by jobId and enforce ownership.  
   Finally remove in-memory store and `recordIdToJobId`; ensure createCheckpointRecord sets `userId` and progress fields.

5. **Enrich route ownership and PB-only progress**  
   - In POST `/api/gpx/enrich`, require auth, verify GPX owner, pass `userId` into checkpoint create.  
   - Rely only on PocketBase for progress and cancellation (no in-memory fallback).

6. **Cancel and delete ownership**  
   - Enforce ownership in POST `/api/gpx/enrichment-cancel`.  
   - Add DELETE `/api/gpx/files/[id]` with ownership check and optionally call cancel for that record; switch client delete to use it (or rely on PB delete rules).

7. **Upload and create rules**  
   - If server upload: add POST `/api/gpx/upload`, set `user` from auth, switch client to use it.  
   - If client create: ensure client sends auth and sets `user`; add PocketBase create rule on `gpx_files`.

8. **Reorder**  
   - Move reorder to server or add PocketBase update rule so users can only update their own records.

---

## 7. Risks and limitations

### 7.1 What Stage 1 solves

- **Multi-user correctness:** Users only see, enrich, cancel, and delete their own files and jobs.  
- **Restart-safe progress:** Progress and cancellation live in PocketBase; no loss on server restart.  
- **Multiple simultaneous jobs:** Safe to run several enrichment jobs at once (same process); each job’s state and progress are isolated by record/job id and user.  
- **Clear data model:** One place (enrichment_jobs) for job state and progress; recordId → job lookup via existing getCheckpointByRecordId.

### 7.2 What Stage 1 does not solve

- **CPU contention:** Multiple enrichments in one Node process still share one event loop and CPU; no worker_threads or separate processes.  
- **Throughput scaling:** No external queue or horizontal scaling; single server only.  
- **Progress write load:** High-frequency progress updates may cause many PocketBase writes; throttling (e.g. 1–2 s) is recommended if needed.  
- **Advanced availability:** No queue-based retries, dead-letter, or multi-instance coordination; that is Stage 2.

---

## 8. Final deliverable summary

### 8.1 Stage 1 target architecture

- **Auth:** PocketBase auth; Next.js APIs get current user from request and enforce ownership.  
- **Data:** `gpx_files` has `user` (relation to users); `enrichment_jobs` has `userId` and progress fields (`overallPercentComplete`, `currentPhase`, `currentPhasePercent`, `error`).  
- **Progress:** Single source of truth in `enrichment_jobs`; no in-memory progress store or recordIdToJobId. Enrich route writes progress to PocketBase; progress API reads by jobId with ownership check.  
- **Cancellation:** Persisted in `enrichment_jobs.status = "cancelled"`; cancel API verifies GPX ownership then calls `markCheckpointCancelled`.  
- **Upload:** Prefer server upload endpoint that sets `user`; alternatively client create with auth and PB create rule.

### 8.2 File-by-file change plan

| File | Change |
|------|--------|
| New: `apps/web/src/lib/auth.ts` (or under api) | `getCurrentUserId(request)` using PocketBase auth. |
| New: `apps/web/src/app/api/gpx/upload/route.ts` | Optional; multipart upload, set user, create gpx_files. |
| New: `apps/web/src/app/api/gpx/files/[id]/route.ts` | GET one / DELETE with ownership. |
| `apps/web/src/app/api/gpx/files/route.ts` | Auth; filter getGpxFilesList by user. |
| `apps/web/src/lib/gpx/files.ts` | getGpxFilesList(pb, userId?) with filter by user. |
| `apps/web/src/app/api/gpx/enrich/route.ts` | Auth; GPX ownership; create checkpoint with userId; replace setProgress/getProgress/register/unregister with PocketBase; isCancelled from PB only. |
| `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` | Add userId to create; add progress fields to create/update; optional updateJobProgress. |
| `apps/web/src/app/api/gpx/enrichment-progress/route.ts` | Auth; get job by jobId from PB; ownership check; return progress from row. |
| `apps/web/src/app/api/gpx/enrichment-progress/store.ts` | Remove or reduce to optional local logging only; all callers use PB. |
| `apps/web/src/app/api/gpx/enrichment-cancel/route.ts` | Auth; verify GPX owner; remove cancelJobForRecord. |
| `apps/web/src/components/gpx/GpxUploadForm.tsx` | Use POST /api/gpx/upload (or set user + auth for pb.create). |
| `apps/web/src/components/gpx/GpxView.tsx` | Delete via DELETE /api/gpx/files/[id] (or keep pb with rules). |
| PocketBase migrations | Add user to gpx_files; add userId + progress fields + indexes to enrichment_jobs. |

### 8.3 Schema change plan

- **gpx_files:** Add `user` (relation, users, single, required: false). Index on `user`.  
- **enrichment_jobs:** Add `userId` (text, required: false), `overallPercentComplete` (number), `currentPhase` (text), `currentPhasePercent` (number), `error` (text); optional `currentTrackIndex`, `totalTracks`. Index on `jobId`; index on `recordId` (and sort by updatedAt where used).

### 8.4 Recommended implementation order

As in section 6: (1) Schema/migrations, (2) Auth helper, (3) Ownership on files list, (4) Progress in PocketBase and progress API, (5) Enrich route full PB progress + ownership, (6) Cancel and delete ownership, (7) Upload path, (8) Reorder.

### 8.5 Defer to Stage 2 (queue / workers)

- External job queue (e.g. Redis/Bull, SQS, or similar).  
- Worker processes or worker_threads for enrichment (off the Next.js request path).  
- Horizontal scaling (multiple servers).  
- Rate limiting, backpressure, and advanced retry/Dead-letter handling.  
- Any further optimization of progress write frequency (e.g. batching in a worker).

---

*End of Stage 1 implementation plan. No code changes were made; this document is analysis and planning only.*
