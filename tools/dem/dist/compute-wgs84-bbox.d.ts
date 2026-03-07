/**
 * Transform raster bbox from native CRS to WGS84 [west, south, east, north].
 */
import type { NativeBbox } from "./types.js";
import type { Wgs84Bbox } from "./types.js";
/**
 * Convert bbox in native CRS to WGS84.
 * Transforms the four corners and returns the enclosing [west, south, east, north].
 */
export declare function nativeBboxToWgs84(nativeBbox: NativeBbox, crs: string): Wgs84Bbox;
