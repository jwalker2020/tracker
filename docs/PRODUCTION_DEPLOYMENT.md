# Production deployment (final approved model)

Deploy with **Docker Compose** or **Coolify**. Public access only at **https://tracker.nhwalker.net** via a **Cloudflare Tunnel**. PocketBase and worker are **internal-only**. Admin accesses PocketBase via **LAN or WireGuard** only.

**PocketBase and worker must not be publicly exposed.** No tunnel, public hostname, or open firewall port for them. Only the web service receives public traffic.

---

## 1. Final service architecture

| Service     | Role                                           | Public? |
|------------|-------------------------------------------------|--------|
| **web**    | Next.js app; all browser and API traffic        | **Yes** — only service exposed (port 3000) |
| **worker** | Enrichment job runner; polls PocketBase, runs DEM | **No** — internal-only, no ports |
| **pocketbase** | Database, auth, file storage; API for web and worker | **No** — internal-only, no host ports |

- Stack: web + worker + pocketbase on one internal Docker network (`tracker`).
- Web and worker use the same image; different `command` in Compose.
- Cloudflare Tunnel (cloudflared) runs **outside** this stack and points only at web.

---

## 2. Required Coolify service settings

| Service     | Build context | Dockerfile   | Command | Expose port? |
|------------|---------------|--------------|---------|--------------|
| **web**    | repo root (`.`) | `Dockerfile` | `pnpm start` | **Yes** — 3000 only |
| **worker** | same image as web | — | `node --import tsx scripts/enrichment-worker.ts` | **No** |
| **pocketbase** | `./apps/pb` | `Dockerfile` | (default: `./pocketbase serve --http=0.0.0.0:8090`) | **No** |

- Do **not** add cloudflared to this stack.
- Do **not** expose any port for worker or pocketbase in Coolify.

---

## 3. Required environment variables

| Variable | Web | Worker | Value / note |
|----------|-----|--------|--------------|
| `NEXT_PUBLIC_PB_URL` | ✅ | ✅ | **Required.** Set to `http://pocketbase:8090` for Docker/Coolify. |
| `DEM_BASE_PATH` | Optional | Optional | e.g. `/data/dem` if using DEM. |
| `DEM_MANIFEST_PATH` | Optional | Optional | e.g. `manifest.json`. |
| `ENRICHMENT_WORKER_POLL_INTERVAL_MS` | — | Optional | Poll interval when idle (default 5000). |

- Do **not** set `GUEST_USER_ID` in production; use real auth only.
- Worker gets all config from container env (no `.env.local`).

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

## 8. Admin access to PocketBase

Admin reaches PocketBase **only** via LAN or WireGuard, using one of these options:

**Option A — SSH port-forward (recommended default)**  
No host port is visible on the network. On the server, expose PocketBase on **localhost only** (e.g. in compose use `127.0.0.1:8090:8090` instead of `8090:8090`). From your admin machine: `ssh -L 8090:localhost:8090 user@server`. Then open **http://localhost:8090/_/** in your browser. Traffic goes over SSH only.

**Option B — LAN/WireGuard-restricted host port**  
In compose, uncomment and use `ports: - "8090:8090"`. Restrict the host firewall so port 8090 is reachable **only** from your LAN or WireGuard (e.g. allow 8090 from 10.0.0.0/8 or your WireGuard subnet). From a machine on that network, open **http://SERVER_IP:8090/_/** (use the server's IP on that network).

- **Never** give PocketBase a public hostname or Cloudflare Tunnel. The only public entry point is the web app at https://tracker.nhwalker.net.

---

## Reference

- **Full deployment guide (local, Coolify, tunnel, admin):** `docs/deployment.md`
- **Docker build and Compose details:** `docs/DOCKER_DEPLOYMENT.md`
- **DEM preparation:** `docs/DEM_DOCKER.md`, `tools/dem/README.md`
