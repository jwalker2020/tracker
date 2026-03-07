/**
 * DEM (Digital Elevation Model) pipeline types.
 * CRS: coordinate reference system. GPX is WGS84 (EPSG:4326).
 */

/** WGS84 (lon/lat) bounding box. Turf and GeoJSON use [west, south, east, north]. */
export type Wgs84Bbox = [number, number, number, number]; // [west, south, east, north]

/** Same as GpxBounds; use for DEM intersection. */
export type GpxBoundsLike = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** CRS identifier (e.g. "EPSG:4326", "EPSG:32610"). */
export type CrsCode = string;

/** Metadata for one DEM GeoTIFF tile (on disk). */
export type DemTileMeta = {
  /** Path relative to DEM root or absolute. */
  path: string;
  /** Bounding box in WGS84: [west, south, east, north]. */
  bbox: Wgs84Bbox;
  /** CRS of the raster (e.g. "EPSG:32610" for UTM). Used by proj4 to transform WGS84 → raster. */
  crs: CrsCode;
  /** Optional nodata value; if absent, treat NaN or a sentinel as nodata. */
  nodata?: number;
};

/** In-memory tile index: tiles keyed by path for deduplication. */
export type DemTileIndex = {
  tiles: DemTileMeta[];
  /** Base directory for resolving tile paths (absolute or relative). */
  basePath: string;
};

/** Result of sampling elevation at one point. */
export type ElevationSample = {
  /** Elevation in meters, or null if nodata / out of extent. */
  elevationM: number | null;
};

/** Elevation stats computed from a sequence of samples. */
export type ElevationStats = {
  minElevationM: number;
  maxElevationM: number;
  totalAscentM: number;
  totalDescentM: number;
  averageGradePct: number;
  /** Number of points that had valid elevation. */
  validCount: number;
  /** Total number of points. */
  totalCount: number;
};
