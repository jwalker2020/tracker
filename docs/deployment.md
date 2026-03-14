# Deployment guide

This document explains how to run and deploy the app with Docker and Coolify. The **Docker Compose** file in the repo root is the source of truth.

**Production target:** Server runs Docker; Coolify manages containers. Public users access **https://tracker.nhwalker.net** via a **Cloudflare Tunnel**. Only the web service is reachable externally. PocketBase and the worker are internal-only. Admin reaches PocketBase via local network or WireGuard.

---

## Architecture

| Service     | Role                                      | In Compose |
|------------|--------------------------------------------|------------|
| **web**    | Next.js app; all browser and API traffic   | Yes        |
| **worker** | Enrichment job runner; polls PocketBase    | Yes        |
| **pocketbase** | Database, auth, file storage            | Yes        |
| **dem-tools** | DEM maintenance tooling (non-runtime)    | Yes        |

- **Same image** runs web and worker (different `command` in compose).
- All four services use a single **internal Docker network** (`tracker`) for communication. Web and worker call PocketBase at `http://pocketbase:8090`. The `dem-tools` service shares the same network but is used only for internal DEM generation via the Coolify UI terminal.

---

## Internal vs external services

| Service     | Externally exposed? | Notes |
|------------|---------------------|--------|
| **web**    | **Yes** (port 3000) | Only service that should receive public traffic. Cloudflare Tunnel points here. |
| **worker** | **No** (no ports)   | Runs inside the stack; no HTTP server. |
| **pocketbase** | **No** (8090 on LAN IP only) | Internal-only. Port 8090 bound to host LAN IP for admin UI; never expose to the internet. |
| **dem-tools** | **No** (no ports) | Internal-only DEM tooling container. Used via Coolify terminal to generate DEM data; never public. |

The browser talks only to the web service. PocketBase is never contacted directly by the public.

---

## Required environment variables

Set in `docker-compose.yml` or in Coolify for each service:

| Variable | Web | Worker | PocketBase / stack | Purpose |
|----------|-----|--------|--------------------|---------|
| `NEXT_PUBLIC_PB_URL` | ✅ | ✅ | — | **Must** be `http://pocketbase:8090` (internal hostname). Never use a public URL. |
| `DEM_BASE_PATH` | Optional | Optional | — | e.g. `/data/dem` if using DEM. |
| `DEM_MANIFEST_PATH` | Optional | Optional | — | e.g. `manifest.json`. |
| `ENRICHMENT_WORKER_POLL_INTERVAL_MS` | — | Optional | — | Poll interval when idle (default 5000). |
| `POCKETBASE_LAN_IP` | — | — | Optional | Host’s LAN IP to bind port 8090 for admin UI (default `127.0.0.1`). Set in Coolify or `.env` for `docker compose`. |

- **Worker** does not use `.env.local`; all configuration comes from the container environment (compose or Coolify).
- **Production:** Do not set `GUEST_USER_ID`; use real auth only.

---

## Enrichment artifact upload (server-only rules)

Sync and async enrichment both write full detail to the **`enrichment_artifacts`** collection (NDJSON file per GPX file) and then update **`gpx_files`** with `hasEnrichmentArtifact`, `enrichmentArtifactIndex`, and `enrichedTracksSummary`. The worker and the sync enrich API create/update records in `enrichment_artifacts`. So that they can do this without admin auth, the collection rules are relaxed for server-only access:

1. **Run migrations**  
   Migrations run automatically when the PocketBase container starts (see `apps/pb/start-pocketbase.sh`). The migration `1790000006_enrichment_artifacts_allow_server_api.js` sets `listRule`, `viewRule`, `createRule`, and `updateRule` to empty string (`""`), which in PocketBase means “anyone can perform the action” (guests, authenticated users, admins).

2. **If you deploy without the new migration**  
   - Build and deploy the PocketBase image that includes the new migration (from `apps/pb`).  
   - Restart the PocketBase container so it runs `pocketbase migrate up` on startup.  
   - Or, once, run migrations manually:  
     `docker compose exec pocketbase /app/pocketbase migrate up`

3. **Security**  
   PocketBase must stay **internal-only** (no public URL, no tunnel). Only the web and worker containers should be able to call it. With that, allowing unauthenticated create/update on `enrichment_artifacts` is acceptable; the API is not exposed to the internet.

---

## Run locally with Docker Compose

From the **repo root**:

```bash
docker compose build
docker compose up -d
```

- **Web:** http://localhost:3000 (only service with a public host port).
- **Worker:** No ports; runs in the background.
- **PocketBase:** Port 8090 is bound to the host’s LAN IP. Set the `POCKETBASE_LAN_IP` environment variable to your server’s LAN address (e.g. in Coolify). From a machine on that network, open `http://<LAN_IP>:8090/_/` for the admin UI.

Stop: `docker compose down`. Data in the `pb_data` volume persists unless you run `docker compose down -v`.

---

## Deploy the stack in Coolify

1. Use the repo’s **docker-compose.yml** as the source of truth.
2. In Coolify, create or import a stack with four services:
   - **web** — Build from repo root (context `.`, Dockerfile `Dockerfile`). Command: `pnpm start`. Expose port **3000** (this is the only service that should be reachable by the tunnel).
   - **worker** — Same image as web. Command: `node --import tsx scripts/enrichment-worker.ts`. **Do not** expose any ports.
   - **pocketbase** — Build from `apps/pb` (context `./apps/pb`, Dockerfile `Dockerfile`). Expose port **8090** bound to the host’s LAN IP only: set `POCKETBASE_LAN_IP` to your server’s LAN IP (not `0.0.0.0`). Attach a persistent volume for **pb_data** at `/app/pb_data`.
   - **dem-tools** — Build from `tools/dem` (context `./tools/dem`, Dockerfile `Dockerfile`). **Do not** expose any ports. Attach the **named volumes** `dem_raw` and `dem_output` so they map to `/workspace/raw` and `/workspace/output` inside the container. Command can be a simple idle command such as `sleep infinity` so the container stays available for terminal access.
3. Set environment variables as in the table above. Ensure `NEXT_PUBLIC_PB_URL=http://pocketbase:8090` for both web and worker.
4. If using DEM, attach the `dem_output` volume read-only for web and worker (`dem_output:/data/dem:ro`) and set `DEM_BASE_PATH` and `DEM_MANIFEST_PATH`.
5. Do **not** add cloudflared to this stack; the tunnel is configured separately (see below).

---

## Cloudflare Tunnel configuration

- **Point the tunnel only at the web service.** Public hostname: `https://tracker.nhwalker.net` → backend: the URL where the **web** container is reachable (e.g. `http://localhost:3000` if the tunnel runs on the same host as Docker, or the host/port Coolify uses for the web service).
- **Do not** create a tunnel or public hostname for PocketBase or the worker.
- Tunnel configuration (cloudflared config, credentials, or Coolify tunnel settings) is **outside** this repo; the app stack does not define or run the tunnel.

---

## PocketBase Admin Access (LAN only)

Port 8090 is published **only on the host’s LAN interface** via the `POCKETBASE_LAN_IP` environment variable (see `docker-compose.yml`: `${POCKETBASE_LAN_IP:-127.0.0.1}:8090:8090`). Set `POCKETBASE_LAN_IP` to your server’s LAN IP in Coolify (or a `.env` file when using `docker compose`). This allows admin access from the same LAN or WireGuard without exposing PocketBase to the public internet.

- **Example admin URL (from a machine on the LAN):** `http://<your-server-lan-ip>:8090/_/`
- If `POCKETBASE_LAN_IP` is unset, the default is `127.0.0.1` (localhost only; use SSH port-forward to reach it).

**PocketBase must NOT be exposed through:** Cloudflare Tunnel, Coolify public services, or any reverse proxy that forwards to the internet. Only the web service receives public traffic.

**Security note:** PocketBase admin access should only be reachable from LAN or WireGuard. The Docker port binding (`IP:8090:8090`) restricts the listen address to that host IP, so the port is not bound on `0.0.0.0`. You can add a firewall rule to allow TCP 8090 only from your LAN or WireGuard subnet for defense in depth.

---

## Other admin options (optional)

- **SSH port-forward:** Expose PocketBase on the host on **localhost only** (e.g. `127.0.0.1:8090:8090` under `pocketbase`) and use `ssh -L 8090:localhost:8090 user@server`; then open http://localhost:8090/_/. No port visible on the network.
- If you set `POCKETBASE_LAN_IP` to your server’s LAN IP, a machine on that network can open `http://<LAN_IP>:8090/_/` directly.

Never expose PocketBase to the public internet.

---

## Persistence and healthchecks

- **PocketBase data:** Stored in the named volume **pb_data** (mounted at `/app/pb_data`). This volume must be attached in Coolify so data survives restarts.
- **Restart policy:** All three services use `restart: unless-stopped`.
- **Healthchecks:** Web (GET `/`) and PocketBase (GET `/api/health`) have healthchecks. Worker has no HTTP server, so no healthcheck.

---

## More detail

- **Docker reference (build, env, DEM, healthchecks):** `docs/DOCKER_DEPLOYMENT.md`
- **Production model, traffic flow, checklist:** `docs/PRODUCTION_DEPLOYMENT.md`
- **DEM preparation:** `docs/DEM_DOCKER.md`, `tools/dem/README.md`
