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

- **Same image** runs web and worker (different `command` in compose).
- All three services use a single **internal Docker network** (`tracker`) for communication. Web and worker call PocketBase at `http://pocketbase:8090`.

---

## Internal vs external services

| Service     | Externally exposed? | Notes |
|------------|---------------------|--------|
| **web**    | **Yes** (port 3000) | Only service that should receive public traffic. Cloudflare Tunnel points here. |
| **worker** | **No** (no ports)   | Runs inside the stack; no HTTP server. |
| **pocketbase** | **No** (no ports) | Internal-only. Never expose to the internet. Admin uses LAN or WireGuard. |

The browser talks only to the web service. PocketBase is never contacted directly by the public.

---

## Required environment variables

Set in `docker-compose.yml` or in Coolify for each service:

| Variable | Web | Worker | Purpose |
|----------|-----|--------|---------|
| `NEXT_PUBLIC_PB_URL` | ✅ | ✅ | **Must** be `http://pocketbase:8090` (internal hostname). Never use a public URL. |
| `DEM_BASE_PATH` | Optional | Optional | e.g. `/data/dem` if using DEM. |
| `DEM_MANIFEST_PATH` | Optional | Optional | e.g. `manifest.json`. |
| `ENRICHMENT_WORKER_POLL_INTERVAL_MS` | — | Optional | Poll interval when idle (default 5000). |

- **Worker** does not use `.env.local`; all configuration comes from the container environment (compose or Coolify).
- **Production:** Do not set `GUEST_USER_ID`; use real auth only.

---

## Run locally with Docker Compose

From the **repo root**:

```bash
docker compose build
docker compose up -d
```

- **Web:** http://localhost:3000 (only service with a host port).
- **Worker:** No ports; runs in the background.
- **PocketBase:** No host ports. To reach the admin UI from your machine (e.g. over WireGuard), uncomment the `ports` block under `pocketbase` in `docker-compose.yml` and restart.

Stop: `docker compose down`. Data in the `pb_data` volume persists unless you run `docker compose down -v`.

---

## Deploy the stack in Coolify

1. Use the repo’s **docker-compose.yml** as the source of truth.
2. In Coolify, create or import a stack with three services:
   - **web** — Build from repo root (context `.`, Dockerfile `Dockerfile`). Command: `pnpm start`. Expose port **3000** (this is the only service that should be reachable by the tunnel).
   - **worker** — Same image as web. Command: `node --import tsx scripts/enrichment-worker.ts`. **Do not** expose any ports.
   - **pocketbase** — Build from `apps/pb` (context `./apps/pb`, Dockerfile `Dockerfile`). **Do not** expose any ports. Attach a persistent volume for **pb_data** at `/app/pb_data`.
3. Set environment variables as in the table above. Ensure `NEXT_PUBLIC_PB_URL=http://pocketbase:8090` for both web and worker.
4. If using DEM, mount the DEM output directory read-only for web and worker and set `DEM_BASE_PATH` and `DEM_MANIFEST_PATH`.
5. Do **not** add cloudflared to this stack; the tunnel is configured separately (see below).

---

## Cloudflare Tunnel configuration

- **Point the tunnel only at the web service.** Public hostname: `https://tracker.nhwalker.net` → backend: the URL where the **web** container is reachable (e.g. `http://localhost:3000` if the tunnel runs on the same host as Docker, or the host/port Coolify uses for the web service).
- **Do not** create a tunnel or public hostname for PocketBase or the worker.
- Tunnel configuration (cloudflared config, credentials, or Coolify tunnel settings) is **outside** this repo; the app stack does not define or run the tunnel.

---

## Admin access to PocketBase (LAN or WireGuard only)

PocketBase has **no public port** in the default compose. **PocketBase must never have a public hostname or public tunnel.** Admin access is only via one of these options:

- **SSH port-forward (recommended default):** Expose PocketBase on the host on **localhost only** (e.g. `127.0.0.1:8090:8090` under `pocketbase` in `docker-compose.yml`). From your machine: `ssh -L 8090:localhost:8090 user@server`, then open http://localhost:8090/_/. No port is visible on the network.
- **LAN/WireGuard-restricted host port:** Uncomment `ports: - "8090:8090"` under `pocketbase` and restrict the host firewall so 8090 is reachable only from your LAN or WireGuard. From a machine on that network, open `http://SERVER_IP:8090/_/` (use the server's IP on that network).

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
