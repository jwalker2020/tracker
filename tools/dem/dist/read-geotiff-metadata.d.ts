/**
 * Read GeoTIFF metadata (bbox in native CRS, CRS, nodata) using geotiff.js.
 */
import type { NativeBbox } from "./types.js";
export type GeoTiffMeta = {
    /** Bounding box in file's native CRS: [minX, minY, maxX, maxY]. */
    nativeBbox: NativeBbox;
    /** CRS string for proj4 (e.g. "EPSG:32619" or proj4 def). */
    crs: string;
    /** Nodata value if present. */
    nodata?: number;
};
/**
 * Read metadata from a GeoTIFF file (first image only).
 * Uses geotiff.js and geotiff-geokeys-to-proj4 for CRS.
 */
export declare function readGeoTiffMetadata(filePath: string, buffer: ArrayBuffer): Promise<GeoTiffMeta>;
