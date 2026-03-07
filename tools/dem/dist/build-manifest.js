/**
 * Build manifest from scanned tiles and optional NH filter.
 */
import { bboxIntersects, NH_BBOX } from "./nh-boundary.js";
/**
 * Build manifest (tiles array). Optionally filter to tiles intersecting NH.
 */
export function buildManifest(tiles, filterToNh) {
    let list = tiles;
    if (filterToNh) {
        list = tiles.filter((t) => bboxIntersects(t.bbox, NH_BBOX));
    }
    const manifestTiles = list.map((t) => ({
        path: t.path,
        bbox: t.bbox,
        crs: t.crs,
        ...(t.nodata != null && { nodata: t.nodata }),
    }));
    return { tiles: manifestTiles };
}
