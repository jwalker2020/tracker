/**
 * Transform raster bbox from native CRS to WGS84 [west, south, east, north].
 */
import proj4 from "proj4";
const WGS84 = "EPSG:4326";
/**
 * Convert bbox in native CRS to WGS84.
 * Transforms the four corners and returns the enclosing [west, south, east, north].
 */
export function nativeBboxToWgs84(nativeBbox, crs) {
    const [minX, minY, maxX, maxY] = nativeBbox;
    if (crs === WGS84 || crs === "EPSG:4326") {
        return [minX, minY, maxX, maxY];
    }
    try {
        const toWgs84 = proj4(crs, WGS84);
        const corners = [
            [minX, minY],
            [minX, maxY],
            [maxX, minY],
            [maxX, maxY],
        ];
        const lonLats = corners.map(([x, y]) => toWgs84.forward({ x, y }));
        const lons = lonLats.map((p) => p.x);
        const lats = lonLats.map((p) => p.y);
        const west = Math.min(...lons);
        const south = Math.min(...lats);
        const east = Math.max(...lons);
        const north = Math.max(...lats);
        return [west, south, east, north];
    }
    catch (err) {
        throw new Error(`CRS transform failed (${crs} → WGS84): ${err instanceof Error ? err.message : String(err)}`);
    }
}
