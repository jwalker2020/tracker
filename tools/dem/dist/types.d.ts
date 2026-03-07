/**
 * Types for the DEM prep utility. Compatible with apps/web/src/lib/dem manifest format.
 */
/** WGS84 bbox: [west, south, east, north]. */
export type Wgs84Bbox = [number, number, number, number];
export type ManifestTile = {
    path: string;
    bbox: Wgs84Bbox;
    crs: string;
    nodata?: number;
};
export type Manifest = {
    tiles: ManifestTile[];
};
/** Raw bbox from GeoTIFF (native CRS): [minX, minY, maxX, maxY]. */
export type NativeBbox = [number, number, number, number];
