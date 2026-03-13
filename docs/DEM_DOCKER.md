# DEM tooling container and consumption by web/worker

DEM data is **always** prepared using the dedicated DEM tooling container. This doc describes how to run it and how web/worker consume its output.

## DEM tooling container (one-shot)

- **Location:** `tools/dem/Dockerfile`, `tools/dem/src/` (CLI: `tsx src/cli.ts` via pnpm scripts).
- **Role:** Download DEM source data (USGS NH), generate `manifest.json`. Writes to mounted directories or named volumes. Not a long-running service.
- **Separate from:** web, worker, pocketbase.

### Run from tracker root

```bash
pnpm dem:docker
```

Builds the image, creates `dem-data/raw` and `dem-data/output`, runs the full pipeline. Single steps:

```bash
pnpm dem:docker -- download
pnpm dem:docker -- process
pnpm dem:docker -- manifest
```

Optional: `DEM_DATA_DIR=/path/to/dem-data pnpm dem:docker` to use a different base directory.

### Running inside the dem-tools container (Coolify)

When the stack runs the `dem-tools` service (e.g. in Coolify), open its terminal and run from `/app`:

- **Full pipeline:** `pnpm run setup-nh -- --output /workspace/output`
- **Download only:** `pnpm run download -- --output /workspace/raw --source usgs-nh --no-manifest`
- **Manifest only:** `pnpm run manifest -- --input /workspace/output --output /workspace/output/manifest.json`

Output goes to `/workspace/output` (volume `dem_output`); raw downloads to `/workspace/raw` (volume `dem_raw`) if using the download step. **Verify:** run `pnpm run setup-nh -- --output /workspace/output`, then `ls -1 /workspace/output` and confirm `manifest.json` exists in `/workspace/output`. See `docs/DOCKER_DEPLOYMENT.md` for volume layout.

### Output directory structure (host or volume)

```
dem-data/
├── raw/                    # Raw downloads (USGS GeoTIFFs)
│   └── *.tif
└── output/                 # Processed tiles + manifest — use this for the app
    ├── manifest.json
    └── *.tif
```

---

## How web and worker consume DEM output

Mount the **output/** directory and set env so the app reads from it.

### Docker Compose (named volumes)

In **docker-compose.yml**, under **web** and **worker** (production server example), use the `dem_output` named volume:

```yaml
environment:
  DEM_BASE_PATH: /data/dem
  DEM_MANIFEST_PATH: manifest.json
volumes:
  - dem_output:/data/dem:ro
```

Docker / Coolify will create the `dem_output` volume automatically. You do not need to SSH into the server or create directories by hand.

For local-only Docker testing, you can still mount a repo-relative folder instead if you prefer:

```yaml
volumes:
  - ./dem-data/output:/data/dem:ro
```

### Local dev (no Docker for app)

After `pnpm dem:docker`, set in `apps/web/.env.local`:

```env
DEM_BASE_PATH=/absolute/path/to/tracker/dem-data/output
DEM_MANIFEST_PATH=manifest.json
```

Use the real absolute path to your repo’s `dem-data/output`.

---

## Summary

| Step | Action |
|------|--------|
| 1. Prepare DEM | `pnpm dem:docker` (from tracker root) |
| 2. Mount output in compose | `dem_output:/data/dem:ro` for web + worker (or `./dem-data/output:/data/dem:ro` for local-only Docker) |
| 3. Set env in compose | `DEM_BASE_PATH=/data/dem`, `DEM_MANIFEST_PATH=manifest.json` |

No Node or GDAL required on the host; the container is the only supported way to prepare DEM data.
