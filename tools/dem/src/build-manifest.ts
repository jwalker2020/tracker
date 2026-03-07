/**
 * Build manifest from scanned tiles and optional NH filter.
 */

import { bboxIntersects, NH_BBOX } from "./nh-boundary.js";
import type { Manifest, ManifestTile, Wgs84Bbox } from "./types.js";

export type TileInput = {
  path: string;
  bbox: Wgs84Bbox;
  crs: string;
  nodata?: number;
};

/**
 * Build manifest (tiles array). Optionally filter to tiles intersecting NH.
 */
export function buildManifest(tiles: TileInput[], filterToNh: boolean): Manifest {
  let list = tiles;
  if (filterToNh) {
    list = tiles.filter((t) => bboxIntersects(t.bbox, NH_BBOX));
  }
  const manifestTiles: ManifestTile[] = list.map((t) => ({
    path: t.path,
    bbox: t.bbox,
    crs: t.crs,
    ...(t.nodata != null && { nodata: t.nodata }),
  }));
  return { tiles: manifestTiles };
}
