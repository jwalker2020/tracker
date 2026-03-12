# DEM prep (container)

DEM (Digital Elevation Model) data for elevation enrichment is **prepared using the DEM tooling container**. You do not need Node or GDAL installed; the container downloads USGS tiles, decompresses them so the app’s geotiff.js can read them, and writes a `manifest.json` and tiles to a mounted directory.

## Run from tracker root

From the **repo root** (`tracker`):

```bash
pnpm dem:docker
```

This builds the image (if needed), creates `dem-data/raw` and `dem-data/output`, and runs the full pipeline (download → process → manifest). Use **`dem-data/output`** for the app (web/worker mount it; see `docs/DEM_DOCKER.md`).

### Single steps

```bash
pnpm dem:docker -- download    # download only (to dem-data/raw)
pnpm dem:docker -- process     # process raw → output only
pnpm dem:docker -- manifest    # regenerate manifest in output only
```

### Custom output directory

```bash
DEM_DATA_DIR=/path/to/dem-data pnpm dem:docker
```

Output is then under `/path/to/dem-data/raw` and `/path/to/dem-data/output`.

## Output layout

```
dem-data/
├── raw/                    # Raw USGS GeoTIFFs (downloads)
│   └── *.tif
└── output/                 # Processed tiles + manifest — mount this for web/worker
    ├── manifest.json
    └── *.tif
```

Idempotent: existing files are skipped. See `docs/DEM_DOCKER.md` for how web and worker consume `dem-data/output`.

## Manual Docker run (optional)

Build and run without the pnpm script:

```bash
docker build -t dem-tools -f tools/dem/Dockerfile tools/dem
mkdir -p dem-data/raw dem-data/output
docker run --rm \
  -v "$(pwd)/dem-data/raw:/workspace/raw" \
  -v "$(pwd)/dem-data/output:/workspace/output" \
  dem-tools all
```

Use `download`, `process`, or `manifest` instead of `all` for a single step.

---

## Advanced: local CLI (developing the tools)

If you are working on the DEM tooling code itself, you can run the TypeScript CLI locally (Node 18+, pnpm). From the repo root after `pnpm install`:

| Goal | Command |
|------|--------|
| One-command NH (download + manifest to one dir) | `pnpm dem:setup:nh` |
| Download only (e.g. from URL list) | `pnpm dem:download -- --output ./data/dem --input urls.txt` or `--source usgs-nh` |
| Manifest only (existing folder) | `pnpm dem:manifest -- --input ./path/to/dem` |

Use `--` before flags. The **standard workflow** remains the container (`pnpm dem:docker`); the local CLI does not run the process step (GDAL decompression), so tiles may still trigger read errors in the app unless you run the container or process tiles elsewhere.

See `apps/web/src/lib/dem/README.md` for the manifest format and pipeline details.
