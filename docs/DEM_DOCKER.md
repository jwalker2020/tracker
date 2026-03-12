# DEM tooling container and consumption by web/worker

DEM data is **always** prepared using the dedicated DEM tooling container. This doc describes how to run it and how web/worker consume its output.

## DEM tooling container (one-shot)

- **Location:** `tools/dem/Dockerfile`, `tools/dem/docker-entry.sh`
- **Role:** Download DEM source data (USGS NH), process (decompress) tiles so geotiff.js can read them, generate `manifest.json`. Writes to mounted host directories. Not a long-running service.
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

### Output directory structure (host)

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

Mount **dem-data/output** and set env so the app reads from it.

### Docker Compose

In **docker-compose.yml**, under **web** and **worker**:

```yaml
environment:
  DEM_BASE_PATH: /data/dem
  DEM_MANIFEST_PATH: manifest.json
volumes:
  - ./dem-data/output:/data/dem:ro
```

So `./dem-data/output` (host) is available at `/data/dem` inside the containers. Run `pnpm dem:docker` first so `dem-data/output` exists.

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
| 2. Mount output in compose | `./dem-data/output:/data/dem:ro` for web + worker |
| 3. Set env in compose | `DEM_BASE_PATH=/data/dem`, `DEM_MANIFEST_PATH=manifest.json` |

No Node or GDAL required on the host; the container is the only supported way to prepare DEM data.
