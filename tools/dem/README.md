# DEM prep utility

TypeScript utility to **download** and **prepare** DEM (Digital Elevation Model) data for the existing DEM enrichment pipeline in `apps/web/src/lib/dem/`. It can run a **single-command New Hampshire setup** or download from a URL list and generate a compatible `manifest.json`.

## Requirements

- Node 18+
- pnpm (monorepo)

## Install

From the repo root:

```bash
pnpm install
```

---

## One-command New Hampshire setup

From the **repo root**, one command downloads NH DEM GeoTIFFs and generates `manifest.json` so the data is ready for the server.

### Exact command (repo root)

```bash
pnpm dem:setup:nh
```

Optional flags:

- **`--output <dir>`** – Output directory (default: `./data/dem/nh`, resolved from repo root).
- **`--force`** – Re-download files that already exist (default: skip existing).

Examples:

```bash
# Default: download to ./data/dem/nh, skip existing
pnpm dem:setup:nh

# Custom output directory
pnpm dem:setup:nh -- --output ./data/dem-nh

# Re-download all files (overwrite existing)
pnpm dem:setup:nh -- --force
```

Use `--` before flags so pnpm passes them to the script (e.g. `pnpm dem:setup:nh -- --force`).

### What the command does

1. Creates the target DEM folder (default `./data/dem/nh`) if it doesn’t exist.
2. Discovers New Hampshire DEM product URLs from the USGS National Map API (1/3 arc-second NED, GeoTIFF).
3. Downloads DEM GeoTIFF files over HTTPS (stream to disk, retries with backoff).
4. Skips files that already exist unless `--force` is passed.
5. Generates `manifest.json` in the folder (path, bbox WGS84, crs, nodata) for the existing pipeline.
6. Prints a success summary and the exact env var to set.

### Where files go

| Item            | Default path (from repo root) |
|-----------------|--------------------------------|
| DEM folder      | `./data/dem/nh`                |
| GeoTIFF files   | Inside that folder             |
| manifest.json   | `./data/dem/nh/manifest.json`  |

With `--output ./my/dem`, everything goes under `./my/dem`.

### Environment variable for the server

The server expects the **absolute path** to the DEM folder (the one that contains `manifest.json` and the GeoTIFFs).

**Env var:**

```bash
DEM_BASE_PATH=/absolute/path/to/data/dem/nh
```

Use the **exact path** printed at the end of `pnpm dem:setup:nh` (it will be the resolved absolute path).

### Exact contents for `apps/web/.env.local`

Add one line (replace with the path printed by `pnpm dem:setup:nh`):

```bash
DEM_BASE_PATH=/Users/you/tracker/data/dem/nh
```

Or, if you used a custom output:

```bash
DEM_BASE_PATH=/Users/you/tracker/data/dem-nh
```

The path must be **absolute** and point to the folder that contains `manifest.json` and the `.tif` files.

### Start the app after setup

From the repo root:

```bash
pnpm dev
```

The DEM enrichment pipeline will use `DEM_BASE_PATH` and the manifest in that folder.

### Force re-download

To re-download all NH DEM files and regenerate the manifest:

```bash
pnpm dem:setup:nh -- --force
```

### Limitations

- **Source:** NH DEM URLs are discovered from the USGS National Map (TNM) API; if the API is down or changes, discovery may fail. You can still use `pnpm dem:download -- --output ./data/dem/nh --input urls.txt` with a manual URL list.
- **Coverage:** Uses 1/3 arc-second NED for New Hampshire; other resolutions or states require a URL list and `dem:download`.
- **Network:** Requires HTTPS access to USGS; downloads can be large and may take several minutes.

---

## Other commands (run from repo root)

### Download from a URL list

Put URLs in **urls.txt** (one per line) or **urls.json**, then:

```bash
pnpm dem:download -- --output ./data/dem --input urls.txt
```

Options: `--concurrency N`, `--force`, `--retries N`, `--no-manifest`. See below for details.

### Download NH from USGS (same as setup, but explicit output)

```bash
pnpm dem:download -- --output ./data/dem/nh --source usgs-nh
```

### Generate manifest only (existing folder)

If you already have a folder of GeoTIFFs:

```bash
pnpm dem:manifest -- --input ./data/dem [--state nh] [--output path]
```

---

## Quick reference

| Goal                    | Command |
|-------------------------|--------|
| **One-command NH setup**| `pnpm dem:setup:nh` |
| NH setup, custom dir    | `pnpm dem:setup:nh -- --output ./data/dem-nh` |
| NH setup, re-download   | `pnpm dem:setup:nh -- --force` |
| Download from file      | `pnpm dem:download -- --output ./data/dem --input urls.txt` |
| Manifest from folder    | `pnpm dem:manifest -- --input ./data/dem --state nh` |

Use `--` before flags when passing options.

---

## URL list formats

**urls.txt** – one URL per line, `#` comments ignored:

```
https://example.com/dem/tile1.tif
https://example.com/dem/tile2.tif
```

**urls.json** – array or `{ "urls": [...] }`:

```json
["https://example.com/a.tif", "https://example.com/b.tif"]
```

---

## Behavior

- **Streaming:** Downloads are streamed to disk.
- **Skip existing:** Files already in the output dir are skipped unless `--force` is set.
- **Retries:** Failed downloads are retried with exponential backoff.
- **Manifest:** Each tile in `manifest.json` has `path`, `bbox` (WGS84 [west, south, east, north]), `crs`, and optional `nodata`, matching `apps/web/src/lib/dem/`.

See `apps/web/src/lib/dem/README.md` for pipeline details.
