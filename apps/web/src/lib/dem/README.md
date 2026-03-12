# DEM enrichment pipeline

Server-side pipeline to sample elevation from local GeoTIFF DEM tiles for GPX tracks and compute elevation stats.

## Preparing DEM data (this project)

DEM data for this project is **prepared using the DEM tooling container**. From the repo root run `pnpm dem:docker`; output (processed tiles + `manifest.json`) is written to `dem-data/output`. Point the app at that folder via `DEM_BASE_PATH` and `DEM_MANIFEST_PATH`. See `tools/dem/README.md` and `docs/DEM_DOCKER.md`.

---

## How to get DEM GeoTIFFs (reference)

Free sources (download GeoTIFF format, not just imagery):

- **US (3DEP)**  
  [USGS National Map](https://apps.nationalmap.gov/downloader/) → Elevation Products → 1/3 arc-second or 1 arc-second DEM. Pick an area and download as GeoTIFF.
- **Global**  
  [OpenTopography](https://opentopography.org/) (various DEMs), [Copernicus DEM](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model), or [SRTM](https://www2.jpl.nasa.gov/srtm/) (often in GeoTIFF).
- **Other regions**  
  Many countries provide national DEMs (e.g. LIDAR) from geological or mapping agencies; look for “DEM” or “DTM” in GeoTIFF.

You need **GeoTIFF** rasters with an affine transform (the app uses origin + resolution). CRS is usually UTM or similar; the manifest (below) must list the correct `crs` for each tile.

## Where to put them

1. **Pick a folder** on the machine where the Next.js app runs (e.g. `/data/dem`, `~/dem`, or a path inside your project). The app only reads files; it does not write there.

2. **Put all GeoTIFF tiles in that folder** (or in subfolders and reference them by relative path in the manifest).

3. **Create `manifest.json`** in that folder. The app loads this to know which tiles exist and their WGS84 bbox and CRS. Example:

   ```json
   {
     "tiles": [
       {
         "path": "n41_w076_1arc_v3.tif",
         "bbox": [-76, 41, -75, 42],
         "crs": "EPSG:32618",
         "nodata": -9999
       }
     ]
   }
   ```
   - `path`: filename (or path relative to the folder), e.g. `"tile1.tif"` or `"subdir/tile2.tif"`.
   - `bbox`: WGS84 `[west, south, east, north]` (decimal degrees). Must contain the tile’s coverage so the app can find which tile to use for a GPX bbox.
   - `crs`: proj4 CRS string for the raster (e.g. `"EPSG:32618"` for UTM 18N). Must match the GeoTIFF’s actual CRS.
   - `nodata`: optional; pixel value that means “no data” (often `-9999`).

4. **Set the env var** so the app knows that folder:
   ```bash
   DEM_BASE_PATH=/absolute/path/to/that/folder
   ```
   In local dev, put that in `apps/web/.env.local` and restart the dev server.

To get `bbox` and `crs` for a GeoTIFF you can use **GDAL** (if installed):

```bash
gdalsrsinfo -o proj4 your_tile.tif   # crs (use EPSG:... if possible)
gdalinfo your_tile.tif               # look for "Upper Left", "Lower Right" in projected coords, then convert to lon/lat, or use gdaltransform
```

Alternatively you can use [QGIS](https://qgis.org/) (Layer → Properties → Information / Source) or a small script that reads the GeoTIFF header and writes `manifest.json`.

## Folder structure (code)

```
apps/web/src/lib/dem/
├── types.ts           # CRS, bbox, tile metadata, elevation result types
├── tile-index.ts      # Load tile index from manifest (JSON)
├── intersect.ts       # Find tiles intersecting a WGS84 bbox (Turf)
├── sampler.ts         # DemRasterSampler: open GeoTIFF, sample at lon/lat, nodata handling
├── elevation-stats.ts # computeElevationStats, computeElevationStatsWithDistance
├── gpx-extract.ts     # Server-only: extract points + bbox from GPX (xmldom)
├── enrich-elevation.ts# Orchestrator: enrichGpxWithDem, enrichGpxWithDemFromIndex
├── index.ts           # Public exports
└── README.md
```

## Local DEM storage assumptions

- **Location**: DEM files live in a single configured folder (e.g. `DEM_BASE_PATH` env or config). The path is set when calling `enrichGpxWithDem({ demBasePath: "/path/to/dem" })` or when loading the tile index.

- **Manifest**: A `manifest.json` file in that folder (or at a custom path) lists the tiles. Format:
  ```json
  {
    "tiles": [
      {
        "path": "tile1.tif",
        "bbox": [west, south, east, north],
        "crs": "EPSG:32610",
        "nodata": -9999
      }
    ]
  }
  ```
  - `path`: relative to the DEM base folder, or absolute.
  - `bbox`: WGS84 [west, south, east, north].
  - `crs`: proj4 CRS string for the raster (e.g. UTM zone).
  - `nodata`: optional; values equal to this (or NaN) are treated as no data.

- **Tiles**: Each tile is a GeoTIFF with an affine transformation (origin + resolution). The pipeline uses `geotiff` to read them and does not modify files.

- **CRS**: GPX coordinates are WGS84 (EPSG:4326). proj4 is used to transform (lon, lat) to the tile’s CRS before sampling. Each tile’s `crs` in the manifest must be a valid proj4 definition (e.g. `EPSG:32610`).

- **No scan step**: The current implementation does not scan the folder to build the index; it relies on the manifest. A future scan step could read each GeoTIFF header to get bbox/CRS and build the manifest.
