# DEM enrichment pipeline

Server-side pipeline to sample elevation from local GeoTIFF DEM tiles for GPX tracks and compute elevation stats.

## Folder structure

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
