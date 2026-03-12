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

**Optional – DEM elevation enrichment:** To sample elevation from local GeoTIFF DEM tiles after each GPX upload, set:

```env
DEM_BASE_PATH=/absolute/path/to/dem
DEM_MANIFEST_PATH=manifest.json
```

- `DEM_BASE_PATH`: folder that contains your DEM tiles and (by default) `manifest.json`. Use an **absolute path** so the server can resolve it reliably.
- `DEM_MANIFEST_PATH`: optional; path to the manifest file relative to `DEM_BASE_PATH` or absolute. Omit or leave default for `manifest.json` in the DEM folder.

If these are unset, uploads still work; elevation stats will use GPX `<ele>` only, and the app may show a non-fatal warning.

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

Elevation enrichment reads DEM GeoTIFF tiles from **local disk**. Suggested setup:

| Where        | How to set DEM variables |
| ------------ | ------------------------- |
| **Local dev** | In `apps/web/.env.local`: `DEM_BASE_PATH=/path/to/your/dem`. Do not commit `.env.local`. |
| **CI / tests** | Set `DEM_BASE_PATH` (and optionally `DEM_MANIFEST_PATH`) in the CI environment or a `.env.test` that is not committed. Use a small fixture folder if you need DEM in tests. |
| **Production** | Set in the host’s env (e.g. systemd, Docker `env`, or your platform’s “Environment variables” for the Next.js app). Use an absolute path that exists on the server (e.g. `/data/dem`). |

**Security:** Keep `DEM_BASE_PATH` server-only (do not prefix with `NEXT_PUBLIC_`). Only the API route uses it. Restrict filesystem access to that directory if needed.

**Manifest:** Put a `manifest.json` in the DEM folder listing each tile’s `path`, `bbox` (WGS84), `crs`, and optional `nodata`. See `apps/web/src/lib/dem/README.md` for the format.

### Enrichment worker (async elevation jobs)

Async elevation enrichment runs in a **separate worker process**, not inside the Next.js server. The web app creates jobs (e.g. when you choose “Enrich” and async is used) and returns a `jobId`; the worker picks up jobs and runs the DEM pipeline.

From the repo root:

```bash
cd apps/web
pnpm run enrichment-worker
```

The worker loads env from `apps/web/.env.local` (or `NEXT_PUBLIC_PB_URL` and DEM vars from the environment). Run one worker per process; it processes one job at a time and polls for the next. For production, run the worker as a separate service (e.g. systemd unit or second container) so jobs continue even when the web app restarts.
