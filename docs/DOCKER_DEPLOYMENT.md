# Docker Deployment

Run the app (web + worker + PocketBase) with Docker Compose. The same setup is the source of truth for Coolify later.

## Quick start

From the repo root:

```bash
docker compose build
docker compose up -d
```

- **Web:** http://localhost:3000 (exposed for local testing).
- **PocketBase:** Internal only (not exposed by default). For local admin or WireGuard access, uncomment `ports: ["8090:8090"]` under `pocketbase` in `docker-compose.yml`.
- **Worker:** No ports; runs in the background.

## Service roles

| Service   | Role                    | Exposed        | Notes |
|-----------|-------------------------|----------------|--------|
| **web**   | Next.js app             | Port 3000      | Public traffic (e.g. via Cloudflare Tunnel) goes here. |
| **worker**| Enrichment job runner   | No             | Polls PocketBase, runs `runEnrichmentJob`. Same image as web. |
| **pocketbase** | DB, auth, files  | No (or 8090 for admin) | Internal only. Web and worker reach it at `http://pocketbase:8090`. |

## PocketBase is internal-only

- The browser **never** talks to PocketBase directly (geometry and logout are proxied through Next.js).
- Web and worker use `NEXT_PUBLIC_PB_URL=http://pocketbase:8090` on the Docker network.
- **Cloudflare Tunnel:** Point `https://tracker.nhwalker.net` only at the **web** service (e.g. `http://web:3000`). Do not create a public hostname or tunnel for PocketBase. Admin uses the server over WireGuard or localhost and can expose 8090 locally if needed.

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

DEM data is always prepared with the DEM tooling container. From the repo root run `pnpm dem:docker`; output goes to `./dem-data/output` (processed tiles + `manifest.json`). Then in `docker-compose.yml`, under **web** and **worker**:

- **volumes:** `- ./dem-data/output:/data/dem:ro`
- **environment:** `DEM_BASE_PATH: /data/dem`, `DEM_MANIFEST_PATH: manifest.json`

See `docs/DEM_DOCKER.md` for the full workflow.

## Build and run commands

- **Build all images:** `docker compose build`
- **Start stack:** `docker compose up -d`
- **View logs:** `docker compose logs -f`
- **Stop:** `docker compose down`

Data in the `pb_data` volume persists across restarts. To reset PocketBase data: `docker compose down -v` (removes volumes).

## Coolify

Use this Compose file as the source of truth. In Coolify you can import the stack or recreate the three services (web, worker, pocketbase) with the same build contexts, commands, env, and volumes. Expose only the web service to the tunnel.
