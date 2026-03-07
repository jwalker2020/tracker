import bboxPolygon from "@turf/bbox-polygon";
import booleanIntersects from "@turf/boolean-intersects";
import type { DemTileMeta, GpxBoundsLike, Wgs84Bbox } from "./types";

/**
 * Convert GPX-style bounds to Turf bbox [west, south, east, north].
 */
export function boundsToWgs84Bbox(b: GpxBoundsLike): Wgs84Bbox {
  return [b.west, b.south, b.east, b.north];
}

/**
 * Find all tiles that intersect the given WGS84 bounding box.
 * Uses Turf bboxPolygon and booleanIntersects for reliable intersection.
 */
export function findIntersectingTiles(
  tiles: DemTileMeta[],
  bbox: Wgs84Bbox
): DemTileMeta[] {
  const queryPoly = bboxPolygon(bbox);
  const result: DemTileMeta[] = [];
  for (const tile of tiles) {
    const tilePoly = bboxPolygon(tile.bbox);
    if (booleanIntersects(queryPoly, tilePoly)) {
      result.push(tile);
    }
  }
  return result;
}
