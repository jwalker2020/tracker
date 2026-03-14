# Production deployment (final approved model)

Deploy with **Docker Compose** or **Coolify**. Public access only at **https://tracker.nhwalker.net** via a **Cloudflare Tunnel**.

- **Web is the only public service** (port 3000). **Worker and PocketBase are internal-only** — no tunnel, public hostname, or exposed port.
- **PocketBase admin is LAN or WireGuard only** (e.g. host port 8090 bound to LAN IP via `POCKETBASE_LAN_IP`).
- **Browser uses same-origin app routes only**; it never talks to PocketBase directly. Set **`NEXT_PUBLIC_PB_URL=http://pocketbase:8090`** (internal hostname) for web and worker in Docker/Coolify.

---

## 1. Final service architecture

| Service     | Role                                           | Public? |
|------------|-------------------------------------------------|--------|
| **web**    | Next.js app; all browser and API traffic        | **Yes** — only service exposed (port 3000) |
| **worker** | Enrichment job runner; polls PocketBase, runs DEM | **No** — internal-only, no ports |
| **pocketbase** | Database, auth, file storage; API for web and worker | **No** — 8090 bound to host LAN IP only (`POCKETBASE_LAN_IP`), not public |

- Stack: web + worker + pocketbase on one internal Docker network (`tracker`).
- Web and worker use the same image; different `command` in Compose.
- Cloudflare Tunnel (cloudflared) runs **outside** this stack and points only at web.

---

## 2. Required Coolify service settings

| Service     | Build context | Dockerfile   | Command | Expose port? |
|------------|---------------|--------------|---------|--------------|
| **web**    | repo root (`.`) | `Dockerfile` | `pnpm start` | **Yes** — 3000 only |
| **worker** | same image as web | — | `node --import tsx scripts/enrichment-worker.ts` | **No** |
| **pocketbase** | `./apps/pb` | `Dockerfile` | (default: `./pocketbase serve --http=0.0.0.0:8090`) | **No** — bind 8090 to LAN IP only (`POCKETBASE_LAN_IP`) |

- Do **not** add cloudflared to this stack.
- Do **not** expose any port for worker. For pocketbase, set `POCKETBASE_LAN_IP` to the host’s LAN IP so 8090 is bound only to that interface, not on all interfaces.

---

## 3. Required environment variables

| Variable | Web | Worker | PocketBase / stack | Value / note |
|----------|-----|--------|--------------------|--------------|
| `NEXT_PUBLIC_PB_URL` | ✅ | ✅ | — | **Required.** Set to `http://pocketbase:8090` for Docker/Coolify. |
| `DEM_BASE_PATH` | Optional | Optional | — | e.g. `/data/dem` if using DEM. |
| `DEM_MANIFEST_PATH` | Optional | Optional | — | e.g. `manifest.json`. |
| `ENRICHMENT_WORKER_POLL_INTERVAL_MS` | — | Optional | — | Poll interval when idle (default 5000). |
| `POCKETBASE_LAN_IP` | — | — | Optional | Host’s LAN IP for 8090 (admin UI). Default `127.0.0.1`. Set in Coolify per server. |

- Do **not** set `GUEST_USER_ID` in production; use real auth only.
- Worker gets all config from container env (no `.env.local`).
- **PocketBase migrations** run automatically on container startup (`apps/pb/start-pocketbase.sh` runs `pocketbase migrate up`). Ensure the PocketBase image includes `pb_migrations/` and the startup script.

---

## 4. Volume requirements

| Service     | Volume | Mount path      | Purpose |
|------------|--------|-----------------|---------|
| **pocketbase** | **pb_data** (named) | `/app/pb_data` | Persistent DB, auth, and files. **Required** so data survives restarts. |
| web / worker | (optional) | `/data/dem` (read-only) | DEM data for elevation enrichment; only if using DEM. |

In Coolify, attach a persistent volume to the pocketbase service at `/app/pb_data`. Do not rely on ephemeral storage for PocketBase.

---

## 5. Cloudflare Tunnel target guidance

- **Target:** Point the tunnel **only** at the **web** service.
- **Example:** Public hostname `https://tracker.nhwalker.net` → backend `http://localhost:3000` (if tunnel runs on same host as Docker) or the URL/port Coolify uses for the web service.
- **Do not** create a tunnel or public hostname for PocketBase or the worker. The only public entry point is the web app.
- Tunnel config (cloudflared or Coolify tunnel) is **outside** this repo.

---

## 6. Final validation checklist

Before and after going live:

- [ ] **Web only exposed** — Only the web service has a public port (3000) or tunnel target. PocketBase and worker have no public ports or hostnames.
- [ ] **PocketBase volume** — Persistent volume `pb_data` attached at `/app/pb_data` so data survives restarts.
- [ ] **Env vars** — `NEXT_PUBLIC_PB_URL=http://pocketbase:8090` for both web and worker; optional DEM and poll interval as needed.
- [ ] **Worker running** — Worker service is in the stack and running (one replica).
- [ ] **Guest auth disabled** — No `GUEST_USER_ID` in production.
- [ ] **Cloudflare Tunnel** — Points only at the web service; no tunnel for PocketBase or worker.
- [ ] **DEM (if used)** — DEM data mounted read-only for web and worker; `DEM_BASE_PATH` and `DEM_MANIFEST_PATH` set in both.
- [ ] **Admin access** — PocketBase admin only via LAN or WireGuard (e.g. expose 8090 on host for that network, or SSH port-forward); never publicly.

---

## 7. PocketBase and worker: no public exposure

- **PocketBase:** Must not be reachable from the public internet. No Cloudflare hostname, no tunnel, no open firewall port to the internet. Admin uses the server over **local network** or **WireGuard** only (optionally expose 8090 on the host for that network).
- **Worker:** No HTTP server and no ports. It must not be exposed via tunnel or proxy. It runs only inside the Docker network.

**PocketBase must never have a public hostname or public tunnel.** Only the web app is public; admin access is via the options below.

---

## 8. PocketBase Admin Access (LAN only)

Port 8090 is published **only on the host’s LAN interface** using the `POCKETBASE_LAN_IP` environment variable (see `docker-compose.yml`). Set it to your server’s LAN IP in Coolify. This gives permanent admin access from the local network or WireGuard without exposing PocketBase to the internet.

- **Purpose:** Allow access to the PocketBase admin UI from machines on the LAN (or over WireGuard) for managing users, collections, and data.
- **Example URL (from a machine on the LAN):** `http://<your-server-lan-ip>:8090/_/`
- If unset, the default is `127.0.0.1` (localhost only).

**PocketBase must NOT be exposed through:** Cloudflare Tunnel, Coolify public services, or reverse proxy routes to the internet. Only the web service is public.

**Security note:** Admin access should only be reachable from LAN or WireGuard. The Docker port binding (`IP:8090:8090`) restricts the listen address so the port is not on `0.0.0.0`. Optionally add a firewall rule allowing TCP 8090 only from your LAN or WireGuard subnet.

- **Never** give PocketBase a public hostname or Cloudflare Tunnel. The only public entry point is the web app at https://tracker.nhwalker.net.

---

## Reference

- **Full deployment guide (local, Coolify, tunnel, admin):** `docs/deployment.md`
- **Docker build and Compose details:** `docs/DOCKER_DEPLOYMENT.md`
- **DEM preparation:** `docs/DEM_DOCKER.md`, `tools/dem/README.md`
