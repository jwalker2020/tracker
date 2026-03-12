# Full-Stack Cursor Starter

A lightweight starter for building full-stack TypeScript apps with:

- Next.js 16
- TypeScript
- Tailwind CSS
- PocketBase
- pnpm workspace
- Cursor-friendly project rules

## Quick start

### Install dependencies

```bash
pnpm install
```

### Start PocketBase

Put the PocketBase binary in `apps/pb/`, then run:

```bash
cd apps/pb
./pocketbase serve
```

### Configure frontend

Create `apps/web/.env.local` (see `apps/web/.env.example` for a template):

```env
NEXT_PUBLIC_PB_URL=http://localhost:8090
```

**Optional – DEM elevation enrichment:** DEM data is prepared using the **DEM tooling container** (no Node or GDAL required on your machine). From the repo root:

```bash
pnpm dem:docker
```

This downloads NH DEM tiles, processes them, and writes output to `./dem-data/output` (tiles + `manifest.json`). Then point the app at that folder:

- **Local dev:** In `apps/web/.env.local`, set `DEM_BASE_PATH` to the **absolute** path to `dem-data/output` (e.g. `/Users/you/tracker/dem-data/output`) and `DEM_MANIFEST_PATH=manifest.json`.
- **Docker:** Mount `./dem-data/output` into the web and worker containers and set `DEM_BASE_PATH=/data/dem`, `DEM_MANIFEST_PATH=manifest.json` (see `docs/DEM_DOCKER.md` and `docker-compose.yml`).

If DEM is unset, **GPX-only enrichment** runs: elevation and stats use GPX `<ele>` only when present.

### Start the app

```bash
pnpm dev
```

## GPX Viewer

The **GPX Viewer** at `/gpx` lets you upload GPX files, store them in PocketBase, and view one or more tracks on a Leaflet map (OpenStreetMap or USGS Topo).

### PocketBase collection for GPX

In the PocketBase admin (e.g. http://localhost:8090/_/), create a collection **`gpx_files`** with these fields:

| Field        | Type   | Notes                    |
| ------------ | ------ | ------------------------ |
| `name`       | Text   | Display name             |
| `file`       | File   | Single file (.gpx)       |
| `uploadedBy` | Text   | Optional                  |
| `boundsJson` | Text   | JSON bounds              |
| `centerLat`  | Number |                          |
| `centerLng`  | Number |                          |
| `trackCount` | Number |                          |
| `pointCount` | Number |                          |
| `color`      | Text   | Hex color for the track  |
| `sortOrder`  | Number | Optional; set by migrations. Used for persistent list order. |

The app fills these on upload. Run `./pocketbase migrate up` from `apps/pb` so migrations add `sortOrder` and allow updates; the GPX list order is then stored in the database.

### DEM storage (elevation enrichment)

DEM data is **always** prepared via the DEM tooling container. From the repo root run `pnpm dem:docker`; output goes to `./dem-data/output` (processed tiles + `manifest.json`). The app (and enrichment worker) then read from that directory.

| Where        | How to use DEM |
| ------------ | ----------------- |
| **Local dev** | After `pnpm dem:docker`, set in `apps/web/.env.local`: `DEM_BASE_PATH=<absolute-path-to-repo>/dem-data/output`, `DEM_MANIFEST_PATH=manifest.json`. Do not commit `.env.local`. |
| **Docker** | Mount `./dem-data/output:/data/dem:ro` for web and worker; set `DEM_BASE_PATH=/data/dem`, `DEM_MANIFEST_PATH=manifest.json` in compose. See `docs/DEM_DOCKER.md`. |
| **Production** | Prepare DEM with the same container (or copy `dem-data/output` to the server), then set `DEM_BASE_PATH` and `DEM_MANIFEST_PATH` in the host/env and mount the directory into the app/worker. |

**Security:** Keep `DEM_BASE_PATH` server-only (do not prefix with `NEXT_PUBLIC_`). Restrict filesystem access to that directory if needed.

### Enrichment worker (async elevation jobs)

Async elevation enrichment runs in a **separate worker process**, not inside the Next.js server. The web app creates jobs (e.g. when you choose “Enrich” and async is used) and returns a `jobId`; the worker picks up jobs and runs the DEM pipeline.

From the repo root:

```bash
cd apps/web
pnpm run enrichment-worker
```

The worker loads env from `apps/web/.env.local` (or `NEXT_PUBLIC_PB_URL` and DEM vars from the environment). Run one worker per process; it processes one job at a time and polls for the next. For production, run the worker as a separate service (e.g. systemd unit or second container) so jobs continue even when the web app restarts.

---

## Testing the full stack (Docker + DEM)

From the **tracker** directory you can test the full flow: DEM container, then app stack with web/worker using that DEM.

**1. Prepare DEM data (one-shot container)**

```bash
pnpm dem:docker
```

- Builds the DEM tools image, creates `dem-data/raw` and `dem-data/output`, runs download → process → manifest.
- First run can take several minutes (downloads NH tiles).
- **Check:** `ls dem-data/output` should show `manifest.json` and `*.tif` files.

**2. Start the app stack**

```bash
docker compose up -d
```

- Builds/uses web and PocketBase images, starts web, worker, pocketbase.
- Web and worker mount `./dem-data/output` as `/data/dem` and use `DEM_BASE_PATH=/data/dem`.

**3. Create a PocketBase user (if you haven’t)**

```bash
docker compose exec pocketbase ./pocketbase superuser upsert your@email.com YourPassword
```

Then in Admin (e.g. http://localhost:8090/_/) ensure the **users** collection exists and add an app user (email + password, **verified** on), or use the CLI-created superuser if that’s how you log in.

**4. Test in the app**

- Open http://localhost:3000 → go to `/gpx`, log in with that user.
- Upload a GPX that has tracks in New Hampshire (within the DEM coverage).
- Start enrichment.
- In logs you should see DEM usage instead of “no DEM”:

  ```bash
  docker compose logs -f worker
  ```

  Look for lines like “Enriching track …” and no “GPX-only enrichment: no DEM” for that run.
- In the UI, confirm elevation/stats appear after enrichment.

**5. Optional: confirm DEM path in the worker**

```bash
docker compose exec worker ls -la /data/dem
```

You should see `manifest.json` and the same `.tif` files as in `dem-data/output`.

**Quick recap**

| Step | Command | What to check |
|------|---------|----------------|
| 1 | `pnpm dem:docker` | `dem-data/output` has `manifest.json` and `.tif` |
| 2 | `docker compose up -d` | All three services running |
| 3 | Create/verify user | Can log in at :3000 |
| 4 | Upload GPX → Enrich | Worker logs show DEM use; UI shows elevation |
| 5 | (optional) | `docker compose exec worker ls /data/dem` shows files |

If the worker still logs “no DEM”, ensure you ran `pnpm dem:docker` from tracker and that `docker compose up` was also run from tracker so `./dem-data/output` is the same directory.
