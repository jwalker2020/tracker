# PocketBase to PostgreSQL: Architectural Assessment and Migration Plan

**Scope:** Analysis only. No code changes. Assumes empty database and no historical data migration.

---

## 1. Current PocketBase Usage Inventory

### 1.1 Authentication / user management

| Usage | How | Files / modules |
|-------|-----|------------------|
| Login | `pb.collection("users").authWithPassword(email, password)`; server sets cookie from `pb.authStore.exportToCookie()` | `apps/web/src/app/api/auth/login/route.ts` |
| Session / current user | Parse cookie in request; `new PocketBase(url); pb.authStore.loadFromCookie(cookie); pb.authStore.model?.id` | `apps/web/src/lib/auth.ts` |
| Logout | Client: `pb.authStore.clear()` then refresh | `apps/web/src/components/auth/LogoutButton.tsx` |
| User identity | Stored as `user` on `gpx_files`, `userId` on `enrichment_jobs`; no separate users table access in app (PB built-in `users` collection) | All API routes that call `getCurrentUserId(request)` |

**Collections:** PocketBase built-in `users` (email, password, etc.). No app-level user CRUD; auth only.

---

### 1.2 Session / cookie handling

| Usage | How | Files |
|-------|-----|--------|
| Set session | Login route sets `Set-Cookie` with PocketBase auth cookie (httpOnly: false, path: /, secure: false) | `apps/web/src/app/api/auth/login/route.ts` |
| Read session | Every protected API and server component: `getCurrentUserId(request)` or `getCurrentUserIdFromHeaders(headers)` → read cookie, load into PB authStore, return `model?.id` | `apps/web/src/lib/auth.ts` |
| Dev fallback | If no cookie, `GUEST_USER_ID` env (optional) | `apps/web/src/lib/auth.ts` |

No server-side session store; session is the PB auth cookie payload.

---

### 1.3 gpx_files storage

| Usage | How | Files |
|-------|-----|--------|
| Create | `pb.collection("gpx_files").create(formData)` with file + metadata (user, name, color, boundsJson, trackCount, etc.) | `apps/web/src/app/api/gpx/upload/route.ts` |
| List | `pb.collection("gpx_files").getList(1, 500, { filter: \`user = "${userId}"\` })`; then sort by sortOrder, created | `apps/web/src/lib/gpx/files.ts` (`getGpxFilesList`) |
| Get one | `pb.collection("gpx_files").getOne(id)` | `apps/web/src/app/api/gpx/enrich/route.ts`, `apps/web/src/app/api/gpx/enrichment-cancel/route.ts`, `apps/web/src/app/api/gpx/files/[id]/route.ts`, `apps/web/src/app/api/gpx/files/route.ts` (PATCH), `apps/web/src/lib/enrichment/runEnrichment.ts` |
| Update | `pb.collection("gpx_files").update(id, update)` for enrich results, sortOrder, etc. | `apps/web/src/app/api/gpx/enrich/route.ts`, `apps/web/src/lib/enrichment/runEnrichment.ts`, `apps/web/src/app/api/gpx/files/route.ts` (PATCH reorder) |
| Delete | `pb.collection("gpx_files").delete(id)` after ownership check | `apps/web/src/app/api/gpx/files/[id]/route.ts` |

**Record shape (from code):** id, name, file (filename), user, boundsJson, centerLat, centerLng, trackCount, pointCount, color, distanceM, minElevationM, maxElevationM, totalAscentM, totalDescentM, averageGradePct, enrichedGeoJson, elevationProfileJson, enrichedTracksJson, performanceJson, sortOrder, created, updated. The `file` field is the GPX attachment; PocketBase stores the binary and serves it at `/api/files/gpx_files/:id/:filename`.

---

### 1.4 enrichment_jobs storage

| Usage | How | Files |
|-------|-----|--------|
| Create | `pb.collection("enrichment_jobs").create(body)` for new job (jobId, recordId, userId, status, totalPoints, chunkSize, etc.) | `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` (`createCheckpointRecord`) |
| Get by recordId | `getList(1, 1, { filter: \`recordId = "${recordId}"\`, sort: "-updatedAt" })` | `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` (`getCheckpointByRecordId`, `getResumableCheckpoint`) |
| Get by jobId | `getList(1, 1, { filter: \`jobId = "${jobId}"\` })` for update target | `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` (`saveCheckpoint`, `updateJobProgress`, etc.) |
| Update | `pb.collection("enrichment_jobs").update(recordIdToUpdate, body)` for progress, status, completed, failed, cancelled | `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` (`saveCheckpoint`, `updateJobProgress`, `markCheckpointCompleted`, `markCheckpointFailed`, `markCheckpointCancelled`) |
| List incomplete | `getList(1, 500, { filter: status running/resumable, optional userId, sort: "-updatedAt" })` | `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` (`getIncompleteEnrichmentJobs`) |
| Active jobs by recordIds | `getList` with filter on recordIds + status + userId | `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` (`getActiveEnrichmentJobIdsForRecordIds`) |

**Record shape (from types):** id, jobId, recordId, status, totalPoints, processedPoints, nextPointIndex, chunkSize, startedAt, updatedAt, lastHeartbeatAt, minElevationM, maxElevationM, totalAscentM, totalDescentM, distanceM, priorElevationM, validCount, profileJson, errorMessage, userId, overallPercentComplete, currentPhase, currentPhasePercent, error, currentTrackIndex, totalTracks.

---

### 1.5 File uploads

| Usage | How | Files |
|-------|-----|--------|
| Upload | Client sends multipart to `POST /api/gpx/upload`; server appends `user` and calls `pb.collection("gpx_files").create(formData)`. PocketBase stores the file as an attachment on the record. | `apps/web/src/app/api/gpx/upload/route.ts` |

No direct client→PocketBase upload in the current flow; all via Next.js API.

---

### 1.6 File downloads / file serving

| Usage | How | Files |
|-------|-----|--------|
| URL construction | `getGpxFileUrl(recordId, fileName, baseUrl)` → `${baseUrl}/api/files/${COLLECTION}/${recordId}/${fileName}` | `apps/web/src/lib/gpx/files.ts` |
| Fetch (server) | Enrich route and runEnrichment fetch GPX body from `NEXT_PUBLIC_PB_URL/api/files/gpx_files/:id/:file` to run enrichment | `apps/web/src/app/api/gpx/enrich/route.ts`, `apps/web/src/lib/enrichment/runEnrichment.ts` |
| Fetch (client) | getDisplayGeometry fetches from same URL when enrichedGeoJson not present (map geometry) | `apps/web/src/lib/gpx/geometry.ts` |

Files are served by **PocketBase** at `/api/files/gpx_files/:recordId/:filename`. The app uses `NEXT_PUBLIC_PB_URL` as base; there is no Next.js proxy for file serving. Browser and Next server both call PocketBase’s file API.

---

### 1.7 Progress / checkpoint persistence

All progress and checkpoint state is stored in **enrichment_jobs** (see 1.4). Throttled writes from runEnrichment and enrich route; progress API and cancel read/update the same collection. No in-memory store; PocketBase is the single source of truth. Files: `apps/web/src/app/api/gpx/enrichment-checkpoint.ts`, `apps/web/src/lib/enrichment/runEnrichment.ts`, `apps/web/src/app/api/gpx/enrich/route.ts`, `apps/web/src/app/api/gpx/enrichment-progress/route.ts`, `apps/web/src/app/api/gpx/enrichment-cancel/route.ts`, `apps/web/instrumentation.ts` (startup resume).

---

### 1.8 Realtime features

None. No PocketBase realtime subscriptions or live queries. Progress is polled via `GET /api/gpx/enrichment-progress?jobId=...`.

---

### 1.9 PocketBase client SDK usage

| Location | Usage |
|----------|--------|
| `apps/web/src/components/auth/LogoutButton.tsx` | `pb.authStore.clear()` then `window.location.reload()` |
| `apps/web/src/lib/pocketbase.ts` | Singleton `new PocketBase(getPocketBaseUrl())`, `autoCancellation(false)` |
| `apps/web/src/lib/pb.ts` | Re-export of `pb` |

No client-side `pb.collection(...).getList` or create/update/delete; all data access is server-side. Client only uses pb for logout.

---

### 1.10 Server-side PocketBase SDK usage

| File | Usage |
|------|--------|
| `apps/web/src/lib/pocketbase.ts` | Default export singleton PB instance |
| `apps/web/src/lib/auth.ts` | New PocketBase per request to load cookie and read `authStore.model?.id` |
| `apps/web/src/app/api/auth/login/route.ts` | New PocketBase, `collection("users").authWithPassword`, `authStore.exportToCookie` |
| `apps/web/src/app/api/gpx/upload/route.ts` | `pb.collection("gpx_files").create(formData)` |
| `apps/web/src/lib/gpx/files.ts` | `pb.collection("gpx_files").getList`, `getGpxFileUrl` (URL only) |
| `apps/web/src/app/api/gpx/files/route.ts` | `pb.collection("gpx_files").getOne`, `update` (reorder) |
| `apps/web/src/app/api/gpx/files/[id]/route.ts` | `pb.collection("gpx_files").getOne`, `delete` |
| `apps/web/src/app/api/gpx/enrich/route.ts` | `pb.collection("gpx_files").getOne`, `update`; checkpoint helpers (pass `pb`) |
| `apps/web/src/app/api/gpx/enrichment-cancel/route.ts` | `pb.collection("gpx_files").getOne`; `markCheckpointCancelled(pb, ...)` |
| `apps/web/src/app/api/gpx/enrichment-progress/route.ts` | `getJobByJobId(pb, ...)` (reads enrichment_jobs) |
| `apps/web/src/app/api/gpx/enrichment-checkpoint.ts` | All enrichment_jobs create/getList/update (takes `pb` as argument) |
| `apps/web/src/lib/enrichment/runEnrichment.ts` | `pb.collection("gpx_files").getOne`, `update`; checkpoint create/update/completed/failed; fetch file from PB URL |
| `apps/web/src/app/gpx/page.tsx` | `getGpxFilesList`, `getActiveEnrichmentJobIdsForRecordIds(pb, recordIds, userId)` |
| `apps/web/src/lib/events.ts` | `pb.collection("events").getList` (CalendarEvent) — may be legacy/unused in main GPX flow |

---

## 2. What PostgreSQL Replaces vs What It Does Not

| Responsibility | PostgreSQL alone | Additional needed |
|----------------|------------------|-------------------|
| **Persisting gpx_files rows** | Yes (table + indexes) | — |
| **Persisting enrichment_jobs rows** | Yes (table + indexes) | — |
| **Storing JSON (enrichedTracksJson, boundsJson, etc.)** | Yes (jsonb/text) | — |
| **Authentication** | No | Session store or JWT; password hashing (e.g. bcrypt); user table or integration with auth provider |
| **Session / cookie handling** | No | Session middleware or JWT in cookie; same-site cookie policy |
| **File storage** | Possible (bytea or large object) but not ideal for large GPX | Prefer: filesystem or object storage (S3-compatible); DB only stores path/key |
| **File serving** | No | Next.js API route (or separate service) to stream file from filesystem/object storage |
| **Migrations** | Schema versioning | Migration tool (e.g. node-pg-migrate, Drizzle Kit, Prisma migrate) |
| **Admin UI** | No | Custom admin or tools (e.g. pgAdmin, Retool) — no PB Admin equivalent out of the box |
| **API generation** | No | All CRUD and auth implemented in Next.js API routes / server code |
| **Realtime** | No | Not used currently; if needed later, separate (e.g. Pusher, Supabase realtime) |

**Summary:** PostgreSQL replaces **all structured data** (gpx_files metadata, enrichment_jobs). It does **not** replace auth, sessions, file storage/serving, migrations tooling, or admin UI; those require additional libraries or services.

---

## 3. Data Model Design in PostgreSQL

### 3.1 users

- **Purpose:** Replace PocketBase built-in users; needed for auth and ownership.
- **Key columns:** id (uuid or text PK), email (unique, not null), password_hash (not null), created, updated. Optional: verified (boolean), name.
- **Relationships:** gpx_files.user_id → users.id; enrichment_jobs.user_id → users.id.
- **Indexing:** PK on id; unique index on email (for login lookup).
- **Notes:** No JSON; simple table. Password hashing (e.g. bcrypt) applied before insert/update.

### 3.2 gpx_files

- **Purpose:** One row per uploaded GPX file; replaces PB `gpx_files` collection.
- **Key columns:** id (uuid PK), user_id (FK to users, not null), name, file_path (text: path in filesystem or key in object storage), bounds_json (text or jsonb), center_lat, center_lng, track_count, point_count, color, distance_m, min_elevation_m, max_elevation_m, total_ascent_m, total_descent_m, average_grade_pct, enriched_geo_json (text), elevation_profile_json (text, nullable), enriched_tracks_json (text/jsonb, nullable), performance_json (text, nullable), sort_order (int, nullable), created, updated.
- **Relationships:** user_id → users.id. enrichment_jobs.record_id → gpx_files.id.
- **Indexing:** PK on id; index on (user_id) for list-by-owner; index on (user_id, sort_order, created) for ordered list.
- **JSON fields:** enriched_tracks_json and performance_json can be jsonb for querying or text for simplicity; current app only reads/writes whole JSON. bounds_json can stay text (small). Large enriched_tracks_json may warrant text to avoid heavy jsonb overhead if never queried by key.
- **File storage:** No BLOB in DB. Column `file_path` (or `file_key`) points to file on disk or in object storage; upload handler writes file and stores path/key.

### 3.3 enrichment_jobs

- **Purpose:** One row per enrichment job; replaces PB `enrichment_jobs` collection.
- **Key columns:** id (uuid PK), job_id (text/uuid, unique), record_id (FK to gpx_files), user_id (nullable, FK to users), status (enum or text), total_points, processed_points, next_point_index, chunk_size, started_at, updated_at, last_heartbeat_at; nullable numeric/JSON fields for progress (min_elevation_m, max_elevation_m, total_ascent_m, total_descent_m, distance_m, prior_elevation_m, valid_count, profile_json); overall_percent_complete, current_phase, current_phase_percent, error, current_track_index, total_tracks.
- **Relationships:** record_id → gpx_files.id; user_id → users.id.
- **Indexing:** PK on id; unique index on job_id (for progress API and lookups); index on (record_id, updated_at) for getCheckpointByRecordId / getResumableCheckpoint; index on (status, user_id) or (status) for getIncompleteEnrichmentJobs and getActiveEnrichmentJobIdsForRecordIds.
- **JSON fields:** profile_json as text (or jsonb if you need to query). Others are scalars.

### 3.4 events (if retained)

- **Purpose:** Only if `lib/events.ts` is used; PB `events` collection.
- **Key columns:** id, title, description, location, start, end, all_day, color, etc. Design per current usage or remove if dead code.

---

## 4. Authentication Replacement

**Current:** Login → PocketBase `authWithPassword` → PB sets auth cookie; APIs read cookie and load into PB authStore to get user id.

**To replace:**

- **Login flow:** Next.js `POST /api/auth/login` accepts email/password; verify password (bcrypt compare) against `users` table; create session (see below) and set HTTP-only cookie; return success.
- **Session cookies:** Either (a) server-side session store (e.g. Redis or PostgreSQL sessions table) with session id in cookie, or (b) signed JWT in cookie (e.g. httpOnly, sameSite, secure). Session must encode user id (and optionally expiry). Same-site cookie so LAN/HTTP works if currently used.
- **Password storage:** Store only bcrypt (or argon2) hash in `users.password_hash`; never plain text.
- **User creation:** No self-registration in current app; either add `POST /api/auth/register` + hash password and insert into `users`, or create users via script/admin. Optional email verification if desired.
- **API auth checks:** Replace `getCurrentUserId(request)` with logic that: reads session cookie → resolves to user id (from session store or JWT verify); returns null if missing/invalid. All existing API routes that call `getCurrentUserId` and enforce ownership stay; only the implementation of `getCurrentUserId` changes.

**Realistic replacement:** Use a small session table in PostgreSQL (session_id, user_id, expires_at) and a cookie holding session_id, or a signed JWT in a cookie. Both fit Next.js server components and API routes; no need for a separate auth server. Libraries: e.g. `jose` for JWT or a simple session middleware that reads/writes the sessions table.

---

## 5. File Storage Changes

**Current:** PocketBase stores the GPX file as an attachment on the `gpx_files` record and serves it at `GET /api/files/gpx_files/:id/:filename`. App builds that URL with `NEXT_PUBLIC_PB_URL` and fetches (server and client).

**Options:**

- **Filesystem:** Next.js API route receives upload, writes to a configured directory (e.g. `UPLOAD_DIR/recordId.gpx` or `user_id/recordId.gpx`), saves path in `gpx_files.file_path`. New route `GET /api/gpx/files/[id]/[filename]` (or similar) checks ownership, then streams file from disk. Simple; good for single-node deployment. Must ensure path is safe (no traversal) and backup includes the directory.
- **Object storage (S3-compatible):** Upload route writes to bucket (key e.g. `gpx/{recordId}/{filename}`); DB stores key. Serve via presigned URL or a Next.js route that proxies from storage. Better for multi-instance and scaling; adds dependency and config.
- **PostgreSQL bytea:** Store file in DB. Works for small/medium GPX; bloats DB and complicates backups. Not recommended as primary.
- **Hybrid:** Metadata and small JSON in PostgreSQL; files on filesystem or object storage.

**Best fit for this codebase:** **Filesystem** is the smallest change: one upload directory, one “file by id” API route that enforces ownership and streams the file. No new external services. If you later need multi-node or durability, add object storage and change the upload/serve logic to use a key in the same table.

---

## 6. Code Impact Analysis

### LOW effort

- **URL construction:** `getGpxFileUrl` and all `${baseUrl}/api/files/...` call sites — switch to a base URL that points to your own file-serving route (e.g. same origin `/api/gpx/files/...`).
- **Error message strings:** Replace “PocketBase” in user-facing errors (e.g. “Is PocketBase running?”) with “database” or “server”.
- **GpxFileRecord type:** Keep the same shape in TypeScript; mapping from DB rows (snake_case) to camelCase can be done in a thin adapter or in SQL select aliases.

### MEDIUM effort

- **enrichment-checkpoint.ts:** Replace every `pb.collection(COLLECTION).getList/getOne/create/update` with PostgreSQL queries (parameterized). Same functions, different backend. Filter/sort expressed as SQL WHERE/ORDER BY. Likely one data-access module (e.g. `enrichment-checkpoint-db.ts`) with the same exported API.
- **lib/gpx/files.ts:** `getGpxFilesList` → one SELECT with filter by user_id, sort by sort_order, created; return array. `getGpxFileUrl` → return URL for new file API. No PB.
- **Upload route:** Parse multipart; validate; write file to disk (or object storage); INSERT into gpx_files (with file_path); return id. No `pb.collection().create(formData)`.
- **Auth:** New implementation of `getCurrentUserId` (session or JWT); login route verifies password and creates session or issues JWT. Logout clears cookie (and optionally invalidates session).
- **Enrich route and runEnrichment:** Fetch GPX from new file endpoint (or direct read from disk in server context) instead of PB file URL; gpx_files getOne/update become SQL. Checkpoint helpers receive a DB client instead of `pb`.
- **Files route (GET list, PATCH reorder), files/[id] (DELETE):** Replace PB getList/getOne/update/delete with SQL. Ownership = WHERE user_id = current_user_id.
- **Enrichment-progress and enrichment-cancel routes:** Already use checkpoint helpers; only the backend of those helpers changes (PB → PG).
- **Gpx page (server component):** Still calls `getGpxFilesList(userId)` and `getActiveEnrichmentJobIdsForRecordIds`; implement those against PostgreSQL. Remove `pb` import.

### HIGH effort

- **No single module is a full rewrite**, but the **persistence layer as a whole** is: every place that touches `pb` or PocketBase collections must be switched to PostgreSQL + new auth + new file storage. That spans many files (see §1.10). The app logic (enrichment pipeline, progress flow, UI) stays; the data layer is replaced.
- **Instrumentation (startup resume):** Today it calls `getIncompleteEnrichmentJobs(pb)` and then `runEnrichmentInBackground`. Same API; implementation of `getIncompleteEnrichmentJobs` becomes a SQL query. Effort is medium if the checkpoint module is abstracted, high if done ad hoc in many places.

---

## 7. Operational Changes

- **Database migrations:** Introduce a migration tool and versioned migrations (e.g. `migrations/001_users.sql`, `002_gpx_files.sql`, `003_enrichment_jobs.sql`). No more `./pocketbase migrate up`; run migrations on deploy or via CI.
- **Backups:** Back up PostgreSQL (pg_dump or managed service backups). Back up file storage (filesystem directory or object bucket) separately. No single PB data directory.
- **Environment variables:** Replace `NEXT_PUBLIC_PB_URL` with something like `DATABASE_URL` (for PostgreSQL) and `NEXT_PUBLIC_APP_URL` or keep base URL for client-visible file URLs if you serve files from the same app. Optional: `UPLOAD_DIR`, `FILE_MAX_SIZE`, etc. Remove PocketBase-specific vars.
- **Deployment:** Run PostgreSQL (local or managed). Run Next.js (and optionally a separate file store). No PocketBase process. If using filesystem storage, ensure the app instance has access to the same path or use shared storage/object store.
- **Developer workflow:** `pnpm dev` starts Next.js only; developer must run PostgreSQL (e.g. Docker, local install) and run migrations. No `./pocketbase serve` or PB admin UI unless replaced by a custom or third-party admin.

---

## 8. Risks

1. **Auth and session design (HIGH):** Getting session scope, cookie options, and logout behavior wrong can cause security or UX issues. Mitigation: use a small, well-understood pattern (e.g. JWT in httpOnly cookie or DB sessions) and keep behavior aligned with current PB flow (e.g. same-site cookie if you rely on it today).
2. **File serving and ownership (HIGH):** New file route must enforce ownership (user can only read their own gpx_files). Missing check exposes other users’ GPX. Mitigation: centralize “get file by id” behind a function that takes current user id and returns 403 if not owner.
3. **Checkpoint and progress semantics (MEDIUM):** enrichment_jobs has many fields and update patterns (create, update by id or by jobId, multiple status transitions). Reimplementing in SQL must preserve ordering and uniqueness (e.g. job_id, record_id) and avoid race conditions. Mitigation: keep the same function signatures and document invariants; test resume and cancel flows.
4. **Run-after-response behavior (MEDIUM):** Enrich runs in background after upload response; it fetches the GPX file and updates DB. With PostgreSQL and filesystem, ensure the file is readable and the DB connection or pool is available in the background context. Mitigation: use a shared connection pool and ensure file path is committed before firing background work.
5. **Operational complexity (MEDIUM):** Two systems (PostgreSQL + file storage) and migrations instead of one PB binary. Mitigation: document runbook and use a single migration runner.
6. **Client logout (LOW):** LogoutButton clears PB authStore and reloads; with new auth, logout must clear the session cookie (and optionally invalidate server session). Simple change but easy to forget.

**Ranked:** (1) Auth/session, (2) File serving/ownership, (3) Checkpoint/progress semantics, (4) Run-after-response, (5) Ops complexity, (6) Logout.

---

## 9. Recommended Migration Approach

**Recommended: focused persistence abstraction, then swap.**

- **Why not full rewrite:** The app is already structured with API routes and server-side data access; enrichment and UI are not tied to PocketBase types except at the persistence boundary.
- **Why not big-bang:** Replacing auth, files, and both collections in one step is riskier. Phasing reduces blast radius.
- **Approach:**
  1. Introduce a **small persistence layer** that hides “where” data lives: e.g. `getGpxFilesList(userId)`, `getCheckpointByRecordId(recordId)`, `createCheckpointRecord(...)`, `updateJobProgress(...)`, etc. Keep the same signatures and return shapes.
  2. Implement that layer once for **PocketBase** (current behavior) and once for **PostgreSQL + filesystem** (new implementation). Use environment or config to choose implementation (or do a single cutover).
  3. **Auth first:** Replace PB auth with PostgreSQL users + sessions (or JWT). All API routes already use `getCurrentUserId(request)`; only that implementation and the login/logout endpoints change.
  4. **File storage second:** Add filesystem (or S3) upload and a file-serving route; change upload and any code that fetches GPX body to use the new storage. DB still stores only metadata and file path/key.
  5. **Data layer third:** Switch gpx_files and enrichment_jobs to PostgreSQL. Migrate the persistence layer to use SQL; remove PB dependency from those modules.
  6. **Cleanup:** Remove PocketBase dependency, PB URL env, and `apps/pb` from the repo (or keep for reference).

This keeps the rest of the application (enrichment pipeline, progress polling, UI) unchanged and limits changes to auth, file I/O, and the persistence layer.

---

## 10. Implementation Roadmap (No Existing Data)

1. **Setup**
   - Add PostgreSQL (local or managed); add `DATABASE_URL`.
   - Add migration tool; create migrations for `users`, `gpx_files`, `enrichment_jobs` (and optionally `sessions` if using DB sessions). Do not migrate data; tables are empty.

2. **Auth**
   - Implement `users` table and password hashing (e.g. bcrypt).
   - Implement session store (DB table or JWT); implement `getCurrentUserId(request)` against it; set/clear cookie in login/logout.
   - Replace login route with email/password check against `users` and session creation.
   - Update LogoutButton to call an endpoint that clears the session cookie (and optionally invalidates session).
   - Create at least one user (script or seed) for testing.

3. **File storage**
   - Choose and configure upload directory (or object storage).
   - Implement `POST /api/gpx/upload`: parse multipart, write file, INSERT into `gpx_files` with `file_path`/`file_key`, return id.
   - Implement `GET /api/gpx/files/[id]/[filename]` (or equivalent): resolve record by id, check `user_id = currentUser`, stream file from disk/storage. Return 403/404 as appropriate.
   - Replace all GPX fetch URLs: server-side fetch and client-side URL should point to the new route (same origin or configured base URL).

4. **gpx_files in PostgreSQL**
   - Implement `getGpxFilesList(userId)` with SELECT and ordering.
   - Replace every `pb.collection("gpx_files").getOne/getList/update/delete` in API routes and runEnrichment with SQL (or with a thin gpx_files repository that uses SQL). Keep the same TypeScript types for the rest of the app.

5. **enrichment_jobs in PostgreSQL**
   - Implement all functions in `enrichment-checkpoint.ts` against PostgreSQL (create, get by recordId, get by jobId, update, mark completed/failed/cancelled, list incomplete, active jobs by recordIds). Keep the same exported API so callers do not change.
   - Pass a DB client (or pool) into these functions instead of `pb`. Update runEnrichment and enrich route to use the new client.

6. **Wire and test**
   - Ensure upload → enrich → progress → cancel → delete and startup resume all use PostgreSQL and the new file storage.
   - Remove `pb` from all remaining modules; remove `NEXT_PUBLIC_PB_URL` from app usage (or repurpose for app base URL only).
   - Update docs and env examples.

7. **Optional**
   - Remove or replace `lib/events.ts` if the `events` collection is unused.
   - Add a simple admin or script to create users.

---

## 11. Final Deliverable

### Summary

- **PocketBase today:** Provides auth (users + cookie), two collections (gpx_files, enrichment_jobs), and file storage/serving for GPX. All app data and file access go through PB or its file API.
- **PostgreSQL replacement:** Covers all relational and JSON state (users, gpx_files, enrichment_jobs). Auth, session, and file storage/serving must be implemented on top of Next.js + PostgreSQL + filesystem (or object storage). Migration is feasible with a focused persistence layer and phased cutover; no change to enrichment pipeline or UI logic beyond the data and auth boundaries.

### PocketBase dependency map

| Area | Depends on PB | Files |
|------|----------------|-------|
| Auth / session | users + cookie | auth.ts, api/auth/login, LogoutButton, pocketbase.ts |
| gpx_files CRUD | collection gpx_files | upload/route, gpx/files.ts, gpx/files/route, gpx/files/[id]/route, enrich/route, enrichment-cancel/route, runEnrichment.ts |
| enrichment_jobs | collection enrichment_jobs | enrichment-checkpoint.ts, enrich/route, enrichment-progress/route, enrichment-cancel/route, runEnrichment.ts, instrumentation.ts |
| File storage | PB file attachment on create | upload/route |
| File serving | PB /api/files/... | geometry.ts, enrich/route, runEnrichment.ts, files.ts (getGpxFileUrl) |
| Page data | getGpxFilesList + getActiveEnrichmentJobIds | gpx/page.tsx |
| Optional | events collection | lib/events.ts |

### What PostgreSQL replaces

- **Fully:** gpx_files metadata storage; enrichment_jobs storage; (with a users table) user identity storage.
- **Does not replace:** Auth flow and cookie handling; file binary storage; file HTTP serving; migrations tooling; admin UI.

### Additional components required

- **Authentication / session:** Library or small implementation for password hashing (e.g. bcrypt), session store (DB table or JWT), and cookie handling.
- **File storage:** Filesystem directory or S3-compatible object storage.
- **File serving:** Next.js API route (or equivalent) that enforces ownership and streams the file.
- **Migrations:** A migration runner and versioned SQL (or ORM migrations).
- **PostgreSQL client:** A driver (e.g. `pg`) or an ORM (e.g. Drizzle, Prisma) for the Node/Next server.

### Main risks

1. Auth/session design and security.
2. File serving and strict ownership checks.
3. Preserving enrichment_jobs semantics and resume/cancel behavior.
4. Background job context (file access, DB pool) after response.
5. Operational complexity (two systems, migrations).

### Recommended architecture

- **PostgreSQL:** users, gpx_files (metadata + file_path), enrichment_jobs, and optionally sessions.
- **Filesystem (or object storage):** GPX file binaries; DB stores only path or key.
- **Next.js API:** All CRUD, auth (login/logout), and file upload/serve implemented in routes; no direct client access to DB or file store.
- **Same app surface:** Existing API routes and their contracts unchanged; only backend (PB → PG + files) and auth implementation change. Enrichment pipeline and UI remain as-is.

### Step-by-step implementation roadmap

1. Add PostgreSQL and migration tool; create empty schema (users, gpx_files, enrichment_jobs, optional sessions).
2. Implement auth: users table, password hash, session or JWT, getCurrentUserId, login/logout routes and cookie; remove PB auth usage.
3. Implement file storage: upload directory (or S3), upload route writes file + INSERT gpx_files, file-serving route (with ownership check) streams file; switch all GPX fetch URLs to new route.
4. Implement gpx_files data access in SQL; replace every PB gpx_files access with the new layer.
5. Implement enrichment_jobs data access in SQL; replace every PB enrichment_jobs access (checkpoint module) with the new layer; pass DB client instead of pb.
6. Remove PocketBase from the app (deps, env, apps/pb); test full flow (upload, enrich, progress, cancel, delete, startup resume).
7. Optional: remove or replace events; add user-creation script or admin.

---

## 12. Recommended Stack for PostgreSQL Migration

Context: **Next.js 16**, **React 19**, **TypeScript**, **Leaflet + ECharts**, **server-side enrichment jobs**. No existing data; fresh PostgreSQL.

### 12.1 PostgreSQL access layer

**Recommendation: Drizzle ORM**

- **Why:** The app uses a small, well-defined set of tables (users, gpx_files, enrichment_jobs) and straightforward operations (CRUD, filtered list, get-one). Drizzle is a thin, type-safe layer: you write SQL-like queries in TypeScript and get strong types from the schema. It fits the “persistence abstraction” approach without ORM magic or N+1 risk.
- **Fit:** Server-only usage (API routes, server components) matches Drizzle’s design. Existing TypeScript types (e.g. `GpxFileRecord`, enrichment job shape) map cleanly to Drizzle schema definitions. No need for Prisma’s broader feature set or the boilerplate of raw `pg` plus manual mapping.
- **Alternatives:** Prisma is viable if you prefer its migration and Studio UX; raw `pg` is minimal but increases boilerplate and type-safety work.

### 12.2 Authentication

**Recommendation: Lucia**

- **Why:** The current model is email/password, a single cookie, and `getCurrentUserId(request)` used everywhere. Lucia is built for “you own the user table” and session-in-database (or cookie-based sessions). It gives a small, explicit API for validate session → user, login, logout, and fits Next.js App Router without pulling in OAuth or a heavy framework.
- **Fit:** You already plan a `users` table in PostgreSQL; Lucia stores sessions in a table and uses an httpOnly cookie. That replaces PocketBase’s cookie and keeps the same mental model: one cookie, resolve to user id on the server. No separate auth service.
- **Alternatives:** Auth.js (NextAuth) is the common Next.js choice; use it if you want the Credentials provider and might add OAuth later. A minimal custom layer (sessions table + `jose` for signing + `bcrypt` for passwords) is also fine and keeps dependencies minimal.

### 12.3 File storage

**Recommendation: Filesystem first; optional S3-compatible later**

- **Why:** GPX files are per-user, uploaded and then read by the same app (enrichment + map). A single writable directory (e.g. `UPLOAD_DIR` or `./data/gpx`) is enough for one instance and keeps the stack simple. Store only the relative path (or filename key) in `gpx_files.file_path`; no DB BLOBs.
- **Fit:** Aligns with the assessment’s “filesystem for minimal change.” No new runtime dependency; Node `fs` (or `fs/promises`) in the upload route and in the file-serving route. If you later need multi-instance or durability, swap to S3-compatible storage (e.g. S3, R2, MinIO) and change only the read/write helpers; the rest of the app still uses `file_path` / key.
- **Tooling:** No dedicated file-storage library required. Optional: `@aws-sdk/client-s3` when you add object storage; use a single abstraction (e.g. `getFileStream(recordId, path)` / `writeFile(recordId, stream)`) so callers stay agnostic.

### 12.4 Migrations

**Recommendation: Drizzle Kit**

- **Why:** If Drizzle is the access layer, Drizzle Kit is the natural choice: the same schema (defined in code) drives both queries and migrations. You get versioned SQL (or JS) migrations and a single source of truth; no separate schema file to keep in sync.
- **Fit:** Small schema (three to four tables); migrations run on deploy or in a pre-start script. Fits the “empty DB” assumption: first run applies all migrations and you’re ready. No need for a second tool (e.g. node-pg-migrate) unless you prefer hand-written SQL only.

### 12.5 Background job persistence

**Recommendation: PostgreSQL only (existing enrichment_jobs table)**

- **Why:** “Background” work today is in-process (run after response + instrumentation resume). Job state is already the `enrichment_jobs` table: create checkpoint, update progress, mark completed/failed/cancelled. There is no separate queue or worker pool; the same Next.js process reads/writes the table and runs the enrichment loop.
- **Fit:** Keep that model. PostgreSQL is the single source of truth for job state; no Redis or external job queue unless you later need retries, backoff, or multi-worker scaling. The persistence layer (Drizzle) reads and updates `enrichment_jobs`; the runner stays as-is.

### 12.6 Developer tooling

**Recommendation:**

- **Database UI:** **Drizzle Studio** (if using Drizzle). It introspects the same schema and DB, so you can browse tables and run ad-hoc queries without leaving the stack. Alternatives: TablePlus, pgAdmin, or any PostgreSQL client.
- **Local PostgreSQL:** **Docker Compose** with a `postgres` service and a volume. Gives a consistent version and one-command start for all developers; document in README and optional `docker-compose.yml` in the repo.
- **Environment:** **`.env.example`** with `DATABASE_URL`, `UPLOAD_DIR`, session secret, and any auth-related vars. No extra tooling required; optional `direnv` for local overrides.
- **Optional:** A small **seed script** (e.g. Drizzle or raw SQL) to create one test user so developers can log in without touching PocketBase.

### 12.7 Stack summary

| Concern | Recommendation | Rationale |
|--------|----------------|-----------|
| PostgreSQL access | Drizzle | Type-safe, thin, schema-as-code; fits small table set and server-only usage. |
| Authentication | Lucia | Own user table + DB sessions; matches current cookie + getCurrentUserId model. |
| File storage | Filesystem (then optional S3) | Simplest for single-instance; path in DB; easy to swap to object storage later. |
| Migrations | Drizzle Kit | Same schema as Drizzle; versioned migrations, one tool. |
| Background job persistence | PostgreSQL (enrichment_jobs) | No extra queue; keep current in-process runner and checkpoint table. |
| Developer tooling | Drizzle Studio + Docker Compose + .env.example | Consistent local DB, schema-aware UI, documented env. |

This stack keeps the existing architecture (Next.js API, server-side enrichment, Leaflet/ECharts) intact and replaces only the data layer, auth, and file storage with a small set of focused tools that fit the project’s scale and patterns.
