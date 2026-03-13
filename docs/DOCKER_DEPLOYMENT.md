# Docker Deployment

Production-ready Docker setup: web, worker, and PocketBase run from **Docker Compose** (source of truth). Same app image runs web and worker; PocketBase is a separate container. The public browser never talks to PocketBase; only web and worker do, over the internal network.

**Single entry point:** **`docs/deployment.md`** — architecture, internal vs external, env vars, run locally, Coolify, Cloudflare Tunnel, admin access.  
**Production (Coolify + Tunnel):** **`docs/PRODUCTION_DEPLOYMENT.md`** — production model, traffic flow, checklist.

## Quick start (local)

From the **repo root** (tracker):

```bash
docker compose build
docker compose up -d
```

Run `docker compose ps` to confirm only the **web** service shows a host port (3000). Worker and pocketbase should have no ports listed.

- **Web:** http://localhost:3000 (port 3000 exposed for local testing and for Cloudflare Tunnel).
- **Worker:** No ports; runs in the background, polls PocketBase for enrichment jobs.
- **PocketBase:** Internal only (no host ports by default). Expose port 8090 only temporarily or on a LAN/VPN-restricted host when admin access is needed (e.g. uncomment the `ports` block under `pocketbase`; prefer `127.0.0.1:8090:8090` for localhost-only). Then run `docker compose up -d` again.

## Service responsibilities and visibility

| Service       | Responsibility                    | Externally reachable? | Notes |
|---------------|-----------------------------------|------------------------|--------|
| **web**       | Next.js app; all browser traffic  | **Yes** (port 3000)   | Only service that should be public. Cloudflare Tunnel points here. |
| **worker**    | Enrichment job runner; polls PB   | **No** (no ports)     | Same image as web; one process per container. Run with concurrency 1. |
| **pocketbase**| DB, auth, files; API for web/worker | **No** (internal-only) | Never expose to the internet. Web and worker use `http://pocketbase:8090` on the Docker network. |
| **dem-tools** | DEM maintenance tooling           | **No** (no ports)     | Internal-only container for generating DEM data; accessed via Coolify terminal, not the public web. |

**What Cloudflare Tunnel should point to in production:** The **web** service only (e.g. `http://web:3000` or `http://localhost:3000` if the tunnel runs on the same host). Public URL: `https://tracker.nhwalker.net`.

**What should never be publicly exposed:** PocketBase (admin and API). The worker (no HTTP server; internal only). **PocketBase must never have a public hostname or public tunnel.** Exposing PocketBase would bypass the app and expose the database and admin UI. Admin access: SSH port-forward (recommended) or LAN/WireGuard-restricted host port — see `docs/deployment.md` and `docs/PRODUCTION_DEPLOYMENT.md`.

## PocketBase is internal-only

- The **public browser never** talks to PocketBase directly. Geometry, auth, and file requests go through the Next.js app (same origin).
- Web and worker talk to PocketBase on the Docker network at `http://pocketbase:8090` (configured via `NEXT_PUBLIC_PB_URL` in this stack). The browser does not call PocketBase directly.
- **Cloudflare Tunnel (production):** Point `https://tracker.nhwalker.net` **only** at the **web** service. Do **not** create a public hostname or tunnel for PocketBase. Admin access: SSH port-forward to localhost (recommended) or LAN/WireGuard-restricted host port — see deployment docs.

## Environment variables

Set in `docker-compose.yml` (or via env file / Coolify):

| Variable | Web | Worker | Purpose |
|----------|-----|--------|---------|
| `NEXT_PUBLIC_PB_URL` | ✅ | ✅ | PocketBase URL; use `http://pocketbase:8090` in Docker. |
| `DEM_BASE_PATH` | Optional | Optional | Path to DEM tiles inside the container (e.g. `/data/dem`). |
| `DEM_MANIFEST_PATH` | Optional | Optional | e.g. `manifest.json`. |
| `ENRICHMENT_WORKER_POLL_INTERVAL_MS` | — | Optional | Poll interval when no job (default 5000). |

The worker does **not** use `.env.local`; all env comes from the container (compose or Coolify).

## Mounting DEM data

DEM data is always prepared with the DEM tooling container. From the repo root you can run `pnpm dem:docker` for local testing, or use the `dem-tools` service in production (see below).

In production, DEM data is stored in **Docker-managed named volumes** — no SSH or manual directory creation on the host is required. The Compose file defines:

- `dem_raw` — raw USGS GeoTIFF downloads
- `dem_output` — processed tiles + `manifest.json` (consumed by the app)

In **docker-compose.yml**, under **web** and **worker**:

- **volumes:** `- dem_output:/data/dem:ro`
- **environment:** `DEM_BASE_PATH: /data/dem`, `DEM_MANIFEST_PATH: manifest.json`

Docker / Coolify will create `dem_raw` and `dem_output` automatically when the stack is started. See `docs/DEM_DOCKER.md` for the full workflow and local options.

## Build and run commands

- **Build all images:** `docker compose build`
- **Start stack:** `docker compose up -d`
- **View logs:** `docker compose logs -f`
- **Stop:** `docker compose down`

**PocketBase data** is stored in the named volume `pb_data` (persists across restarts). To reset: `docker compose down -v` (removes volumes).

## Healthchecks and restart policies

- **web:** Healthcheck hits `http://127.0.0.1:3000/` (interval 30s, 3 retries). Restart: `unless-stopped`.
- **pocketbase:** Healthcheck hits `http://127.0.0.1:8090/api/health`. Restart: `unless-stopped`.
- **worker:** No healthcheck (no HTTP server; polling process). Restart: `unless-stopped`.

Orchestrators (e.g. Coolify) can use these healthchecks for readiness and restart decisions.

## Resource and concurrency notes

- **Worker concurrency:** Run **one worker replica** (concurrency 1). The worker processes one job at a time; multiple replicas would compete for the same jobs unless you add a proper queue.
- **DEM mount:** Mount the DEM output volume **read-only** (`:ro`). In production Compose, web and worker use the named volume `dem_output:/data/dem:ro`.
- **PocketBase data:** Must be **persisted**. Use the named volume `pb_data`; do not run PocketBase without a volume or data will be lost on restart.

## Production deployment (Cloudflare Tunnel)

1. Run the stack on the server (same `docker compose up -d` or your orchestrator).
2. Configure **Cloudflare Tunnel** (or any reverse proxy) so that **only** the **web** service is public:
   - Public URL: `https://tracker.nhwalker.net`
   - Backend: `http://web:3000` (or `http://localhost:3000` if the tunnel runs on the same host as Docker).
3. Do **not** expose PocketBase or the worker to the internet. Keep them on the internal Docker network (and optional LAN/WireGuard for admin).

## Reference

| Question | Answer |
|----------|--------|
| **Start the stack locally** | From repo root: `docker compose build` then `docker compose up -d`. |
| **Command that runs web** | `pnpm start` (Next.js). Override in compose: `command: ["pnpm", "start"]`. |
| **Command that runs worker** | `node --import tsx scripts/enrichment-worker.ts`. Set in compose for the worker service. |
| **Where PocketBase data is persisted** | Named volume `pb_data`, mounted at `/app/pb_data` in the pocketbase container. Survives `docker compose down`; removed only with `docker compose down -v`. |
| **Key artifacts** | Root `Dockerfile` (app image), `apps/pb/Dockerfile` (PocketBase), `tools/dem/Dockerfile` (DEM tooling), `docker-compose.yml` (web, worker, pocketbase, dem-tools). |

## Coolify

Use this Compose file as the source of truth. In Coolify you can import the stack or recreate the four services (**web**, **worker**, **pocketbase**, **dem-tools**) with the same build contexts, commands, env, and volumes.

- Expose **only** the web service to the tunnel.
- **Do not** assign a public domain, ingress, or exposed port to the worker, pocketbase, or dem-tools services.
- On first deployment, create the initial PocketBase admin user via LAN/WireGuard or temporary local-only port exposure (see deployment docs).

### DEM tools service (maintenance container)

- **Service name:** `dem-tools` (internal-only).
- **Image/build:** Uses `tools/dem/Dockerfile` to build the DEM tooling image.
- **Volumes:** Mounts your DEM working directory, for example:
  - `/srv/tracker/dem-data/raw` → `/workspace/raw`
  - `/srv/tracker/dem-data/output` → `/workspace/output`
- **Command:** Uses an idle shell command (e.g. `sleep infinity`) so the container stays up and is accessible from the Coolify UI terminal. The DEM pipeline itself is run manually via `/docker-entry.sh` inside the container.

To generate or update DEM data in production:

1. In Coolify, open the **terminal for the `dem-tools` service**.
2. From the shell prompt inside the container, run one of:
   - `./docker-entry.sh all` — full pipeline (download → process → manifest).
   - `./docker-entry.sh download` — download tiles into `/workspace/raw` only.
   - `./docker-entry.sh process` — process raw tiles from `/workspace/raw` into `/workspace/output`.
   - `./docker-entry.sh manifest` — regenerate `manifest.json` in `/workspace/output`.
3. **Raw files:** Written under `/workspace/raw` (host: `/srv/tracker/dem-data/raw`).
4. **Processed output:** Decompressed tiles and `manifest.json` under `/workspace/output` (host: `/srv/tracker/dem-data/output`).
5. To verify success from the Coolify terminal, run:
   - `ls -1 /workspace/raw` — should list raw `.tif` files.
   - `ls -1 /workspace/output` — should list processed `.tif` files and `manifest.json`.
6. Web and worker already mount `/srv/tracker/dem-data/output:/data/dem:ro`, so they automatically consume the generated DEM data once those files exist.
