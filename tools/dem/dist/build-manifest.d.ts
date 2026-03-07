/**
 * Build manifest from scanned tiles and optional NH filter.
 */
import type { Manifest, Wgs84Bbox } from "./types.js";
export type TileInput = {
    path: string;
    bbox: Wgs84Bbox;
    crs: string;
    nodata?: number;
};
/**
 * Build manifest (tiles array). Optionally filter to tiles intersecting NH.
 */
export declare function buildManifest(tiles: TileInput[], filterToNh: boolean): Manifest;
