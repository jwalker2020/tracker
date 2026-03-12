# Deployment Readiness Checklist & Implementation Plan

**Target:** App on local network, Docker + Coolify; public at `https://tracker.nhwalker.net` via Cloudflare Tunnel; PocketBase internal-only; separate enrichment worker.

**Status:** Planning only. Execution order and blocker levels guide what to do first.

---

## 1. App-level blockers (current status)

| Item | Status | Notes |
|------|--------|------|
| Browser-side PocketBase dependency removal | **Done** | Geometry loads via same-origin route; no client fetch to PocketBase. |
| Same-origin GPX/geometry proxy | **Done** | `GET /api/gpx/files/[id]/file` with auth/ownership; browser only hits Next.js. |
| Logout route replacing client PocketBase SDK | **Done** | `POST /api/auth/logout` clears cookie; LogoutButton uses fetch only. |
| Client dependence on NEXT_PUBLIC_PB_URL for network requests | **Done** | No client component imports pocketbase; all browser requests are same-origin. |

**Remaining app-level blockers:** None for the internal-only PocketBase model. Remaining work is **infrastructure and deployment** (Docker, env, tunnel, validation).

---

## 2. Staged checklist

### App-level blockers

| # | Item | Description | Why it matters | Level | Order |
|---|------|-------------|----------------|-------|-------|
| A1 | (None) | Browser no longer needs direct PocketBase access. | — | — | — |

### Docker / containerization tasks

| # | Item | Description | Why it matters | Level | Order |
|---|------|-------------|----------------|-------|-------|
| D1 | Dockerfile for app image | Single Dockerfile (e.g. in `apps/web/` or root) that builds Next.js (`pnpm build`) and can run either `next start` or the worker. Include Node, pnpm, and worker entry (e.g. `node --import tsx scripts/enrichment-worker.ts` or pre-compiled worker). | Web and worker must run from a reproducible image. | Blocker | 1 |
| D2 | Worker run without .env file | Worker today uses `--env-file=.env.local`. In Docker, env must come from container env (or Coolify env). Document/use env vars only so `node --import tsx scripts/enrichment-worker.ts` (or equivalent) works without a file. | Containers get env from orchestrator, not from a bind-mounted .env file. | Blocker | 2 |
| D3 | Next.js build and PB URL | Build with `NEXT_PUBLIC_PB_URL` set to the **internal** PocketBase URL (e.g. `http://pocketbase:8090`) if any client code still inlines it; or ensure no client code references it (current state: none). Verify client bundle does not contain a public PB URL. | Public users must never see or use internal PB URL. | Blocker | 3 |
| D4 | Healthcheck for web | Add a simple HTTP healthcheck (e.g. GET `/` or `/api/health` if added) for Coolify/Docker. | Orchestrator needs to know when the app is up. | Important | 4 |
| D5 | Healthcheck for worker | Optional: worker logs "loop started" or exposes a trivial health endpoint; or rely on process liveness. | Helps debugging; not required for minimal deploy. | Optional | 5 |

### PocketBase container / persistence tasks

| # | Item | Description | Why it matters | Level | Order |
|---|------|-------------|----------------|-------|-------|
| P1 | PocketBase image or binary | Provide PocketBase in a container (official image, or Dockerfile that downloads the binary for the target arch). | PB must run in the same stack. | Blocker | 6 |
| P2 | PocketBase data volume | Persistent volume for `pb_data/` (and correct working dir so PB writes there). | Data and migrations must survive restarts. | Blocker | 7 |
| P3 | PocketBase migrations in image | Include `pb_migrations/` in the PB container or mount so `serve` or `migrate up` runs migrations. | Schema must exist for gpx_files, enrichment_jobs, etc. | Blocker | 8 |
| P4 | PocketBase bind address | Ensure PB listens on `0.0.0.0` (or the right interface) so web and worker containers can reach it. | Other containers resolve PB by service name. | Blocker | 9 |
| P5 | No public exposure of PB | Do not expose PocketBase port to the internet; only to local network / Docker network. Coolify/tunnel must not proxy PB. | Keeps PB internal-only. | Blocker | 10 |

### Environment variable tasks

| # | Item | Description | Why it matters | Level | Order |
|---|------|-------------|----------------|-------|-------|
| E1 | Web env | `NEXT_PUBLIC_PB_URL` = internal PB URL (e.g. `http://pocketbase:8090`). Optional: `DEM_BASE_PATH`, `DEM_MANIFEST_PATH` if using DEM. No `GUEST_USER_ID` in production. | Server and API routes need PB URL; client must not use it for requests (already satisfied). | Blocker | 11 |
| E2 | Worker env | Same PB URL as web; same DEM vars if DEM is used. Optional: `ENRICHMENT_WORKER_POLL_INTERVAL_MS`. Worker must not rely on `.env.local` file. | Worker must reach PB and optional DEM path. | Blocker | 12 |
| E3 | PocketBase env | Only if PB image supports env (e.g. bind address). Otherwise configure via command or config file. | Optional for minimal PB in Docker. | Optional | 13 |
| E4 | Local Docker testing | Use `.env.docker` or compose `env_file` with internal URLs (e.g. `NEXT_PUBLIC_PB_URL=http://pocketbase:8090`). | Validates stack before Coolify. | Important | 14 |
| E5 | Coolify production | Set env in Coolify for web and worker services; no secrets in repo. | Production security and correctness. | Blocker | 15 |

### Coolify deployment tasks

| # | Item | Description | Why it matters | Level | Order |
|---|------|-------------|----------------|-------|-------|
| C1 | Web service | Deploy app image; command `next start` (or equivalent); expose port; set env. | Public traffic goes to web only. | Blocker | 16 |
| C2 | Worker service | Deploy same image (or worker-only image); command = worker entrypoint; do not expose port; set same PB URL (and DEM if used). | Async jobs run in worker. | Blocker | 17 |
| C3 | PocketBase service | Run PB container; persistent volume; not exposed publicly. | Data and auth live here. | Blocker | 18 |
| C4 | Network | Web and worker must resolve PocketBase by service name (e.g. `pocketbase:8090`). | Internal communication. | Blocker | 19 |
| C5 | Tunnel to web only | Cloudflare Tunnel (or Coolify tunnel) targets only the web app (e.g. port 3000). Do not create a public hostname for PocketBase. | Public users only hit tracker.nhwalker.net. | Blocker | 20 |

### Cloudflare Tunnel tasks

| # | Item | Description | Why it matters | Level | Order |
|---|------|-------------|----------------|-------|-------|
| T1 | Tunnel to Next.js | Configure tunnel so `https://tracker.nhwalker.net` → web container (e.g. `http://web:3000` or localhost if single host). | Public access without exposing PB. | Blocker | 21 |
| T2 | No tunnel for PocketBase | Do not create a public hostname or tunnel for PocketBase. Admin uses local/WireGuard access only. | Keeps PB internal-only. | Blocker | 22 |

### Validation / testing tasks

| # | Item | Description | Why it matters | Level | Order |
|---|------|-------------|----------------|-------|-------|
| V1 | Public browser → web only | From a device that cannot reach the local network, open `https://tracker.nhwalker.net`. All requests go to that origin; no direct PB URL in network tab. | Confirms tunnel and no client PB dependency. | Blocker | 23 |
| V2 | Login | Log in via the app; cookie set by Next.js; no request to PocketBase from browser. | Auth works through proxy. | Blocker | 24 |
| V3 | Upload | Upload a GPX file; succeeds via `/api/gpx/upload`. | CRUD and ownership. | Blocker | 25 |
| V4 | Enrich (async) | Start enrichment; get `jobId`; worker picks up job and runs. | Worker and checkpoint flow. | Blocker | 26 |
| V5 | Progress | Poll progress; UI updates; no browser request to PB. | Progress API and ownership. | Important | 27 |
| V6 | Cancel | Cancel job; worker sees cancelled status. | Cancel flow. | Important | 28 |
| V7 | Map geometry | Load map with a file that has no or minimal `enrichedGeoJson`; geometry loads via `GET /api/gpx/files/[id]/file`; no PB URL in browser. | Same-origin proxy in use. | Blocker | 29 |
| V8 | PocketBase never from public browser | In browser devtools, confirm no request to PocketBase origin (only to tracker.nhwalker.net). | Final check for internal-only PB. | Blocker | 30 |

### Optional hardening tasks

| # | Item | Description | Why it matters | Level | Order |
|---|------|-------------|----------------|-------|-------|
| H1 | Dedicated health route | Add `GET /api/health` returning 200 if app is up (optional). | Clean healthcheck target. | Optional | — |
| H2 | Worker as compiled JS | Build worker to JS (e.g. tsc) and run with `node` without tsx in production image. | Smaller image; no TS source in prod. | Optional | — |
| H3 | Restart policies | Set restart policy for web, worker, and PB in compose/Coolify. | Resilience. | Optional | — |

---

## 3. Remaining app-level blockers

**None.** The following are already done:

- **Browser-side PocketBase dependency removal** — Geometry uses `GET /api/gpx/files/[id]/file`; logout uses `POST /api/auth/logout`. No client fetch to PocketBase.
- **Same-origin GPX/geometry proxy** — Implemented; auth and ownership enforced.
- **Logout route** — Implemented; client no longer uses PocketBase SDK.
- **Client and NEXT_PUBLIC_PB_URL** — No client code uses it for network requests; only server/worker use it.

Remaining blockers are **infrastructure**: Docker images, compose (or Coolify services), PocketBase container and volume, env, tunnel, and validation.

---

## 4. Required Docker artifacts

| Artifact | Purpose |
|----------|---------|
| **Dockerfile** (e.g. `apps/web/Dockerfile` or root) | Build Node app: install deps, `pnpm build`, optional worker build. Image must support both `next start` and worker command. |
| **docker-compose.yml** (or Coolify stack) | Define services: **web** (next start), **worker** (worker entrypoint), **pocketbase** (serve). Shared network. |
| **PocketBase image** | Use official image or Dockerfile that adds PB binary + `pb_migrations/`; working dir with `pb_data` volume. |
| **Web/worker command** | Web: `pnpm start` or `next start`. Worker: `node --import tsx scripts/enrichment-worker.ts` (or `node scripts/enrichment-worker.js` if compiled); env from container. |
| **Volume mounts** | PocketBase: one persistent volume for `pb_data`. Optional: read-only DEM volume (prepare with `pnpm dem:docker`; mount `dem-data/output` at `DEM_BASE_PATH` for web and worker). |
| **Healthchecks** | Web: `GET /` or `GET /api/health` (if added). Worker: optional. PocketBase: optional `GET /api/health` if available. |
| **Restart policies** | e.g. `unless-stopped` or `on-failure` for web, worker, and PB. |

---

## 5. Environment variable strategy

| Context | Variables | Notes |
|---------|-----------|--------|
| **Web** | `NEXT_PUBLIC_PB_URL` (internal, e.g. `http://pocketbase:8090`). Optional: `DEM_BASE_PATH`, `DEM_MANIFEST_PATH`. | Set at build if needed for any inlined value; at runtime for server. No `GUEST_USER_ID` in prod. |
| **Worker** | Same `NEXT_PUBLIC_PB_URL`. Same DEM vars if used. Optional: `ENRICHMENT_WORKER_POLL_INTERVAL_MS`. | Must be set in container env (not .env file). |
| **PocketBase** | Usually none required; or bind address if supported. | Depends on image. |
| **Local Docker** | Compose `env_file` or `environment` with `NEXT_PUBLIC_PB_URL=http://pocketbase:8090` (and DEM paths if testing DEM). | Use internal service names. |
| **Coolify production** | Set per service in Coolify UI (or env file in repo that is not committed). Web and worker get same PB URL. | No localhost; use internal hostname. |

---

## 6. Minimum end-to-end validation path

Before treating the deployment as production-ready, run through this path **from a public browser** (e.g. phone off WiFi or another network):

1. **Public browser → web** — Open `https://tracker.nhwalker.net`; page loads (no direct PB request).
2. **Login** — Sign in; cookie set by Next.js; no PB in network tab.
3. **Upload** — Upload a GPX file; success via `/api/gpx/upload`.
4. **Enrich** — Start async enrichment; receive `jobId`; worker claims and runs job.
5. **Progress** — See progress in UI (polling `/api/gpx/enrichment-progress`).
6. **Cancel** (optional) — Cancel a job; worker stops.
7. **Map geometry** — View map; ensure at least one file loads geometry via same-origin route (check network: only `tracker.nhwalker.net`, no PB host).
8. **Logout** — Log out; cookie cleared by `/api/auth/logout`.

**Criterion:** In browser devtools, **no request** to PocketBase’s URL; all traffic to `https://tracker.nhwalker.net`.

---

## 7. Prioritized step-by-step plan

### Do first (blockers)

1. **Dockerfile for app** — Build Next.js and support worker; no .env file dependency for worker (D1, D2).
2. **PocketBase in Docker** — Image or Dockerfile, `pb_data` volume, migrations, listen on `0.0.0.0` (P1–P4).
3. **Compose (or Coolify equivalents)** — Web, worker, PocketBase; shared network; env for PB URL (and DEM if used) (D3, E1, E2, C1–C4).
4. **Env for local Docker** — `NEXT_PUBLIC_PB_URL=http://pocketbase:8090` (or service name) for web and worker (E4).
5. **Cloudflare Tunnel** — Point `https://tracker.nhwalker.net` at web only; no tunnel for PocketBase (T1, T2, C5).
6. **Validation** — Run the minimum E2E path from a public browser; confirm no PB requests from client (V1–V8).

### Can wait until later

- Health route and healthchecks (D4, H1).
- Worker compiled to JS (H2).
- Restart policies and optional worker health (D5, H3).
- Coolify-specific tuning once base Docker + tunnel work.

### Top 3 remaining blockers for production readiness

1. **No containerization** — Need a Dockerfile and a way to run web, worker, and PocketBase (compose or Coolify) with correct env and no .env file for the worker.
2. **PocketBase not in Docker** — Need PB as a container with persistent storage and migrations, listening on a network-visible address.
3. **Tunnel and validation** — Need Cloudflare Tunnel to web only and one full E2E pass from a public browser proving no direct PocketBase access and all flows working.

---

*Document reflects the current codebase: internal-only PocketBase app changes are done; Docker artifacts (Dockerfile, apps/pb/Dockerfile, docker-compose.yml) and deployment docs (docs/DOCKER_DEPLOYMENT.md) have been added. Remaining work: run stack locally, configure tunnel, and validate E2E.*
