/**
 * Server-side only: extract points and bbox from GPX using xmldom.
 * GPX coordinates are WGS84; we output points as [lat, lng] to match GpxTrack.
 */

import { DOMParser } from "@xmldom/xmldom";
import type { GpxBoundsLike } from "./types";

export type GpxPointsAndBounds = {
  points: Array<[number, number]>; // [lat, lng] per point, order preserved
  bounds: GpxBoundsLike;
};

function parseFloatAttr(el: Element, name: string): number {
  const v = el.getAttribute(name);
  return v ? parseFloat(v) : 0;
}

/**
 * Parse GPX XML and return all track/route points and the bounding box.
 * Uses @xmldom/xmldom for Node. Points are [lat, lng] in WGS84.
 */
export function extractPointsAndBounds(gpxText: string): GpxPointsAndBounds {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "text/xml");
  const points: Array<[number, number]> = [];

  const trkpts = doc.querySelectorAll("trkpt");
  const rtepts = doc.querySelectorAll("rtept");
  const nodes = [...trkpts, ...rtepts];

  let minLat = Infinity,
    minLng = Infinity,
    maxLat = -Infinity,
    maxLng = -Infinity;

  nodes.forEach((pt) => {
    const lat = parseFloatAttr(pt, "lat");
    const lon = parseFloatAttr(pt, "lon");
    if (Number.isNaN(lat) || Number.isNaN(lon)) return;
    points.push([lat, lon]);
    minLat = Math.min(minLat, lat);
    minLng = Math.min(minLng, lon);
    maxLat = Math.max(maxLat, lat);
    maxLng = Math.max(maxLng, lon);
  });

  const bounds: GpxBoundsLike =
    points.length > 0
      ? { south: minLat, west: minLng, north: maxLat, east: maxLng }
      : { south: 0, west: 0, north: 0, east: 0 };

  return { points, bounds };
}
