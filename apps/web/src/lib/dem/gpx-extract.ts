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

const EMPTY: GpxPointsAndBounds = {
  points: [],
  bounds: { south: 0, west: 0, north: 0, east: 0 },
};

function parseFloatAttr(el: Element, name: string): number {
  const v = el.getAttribute(name);
  return v ? parseFloat(v) : NaN;
}

/** True if value is a finite number suitable for WGS84. */
function isFiniteCoord(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 90;
}

function isFiniteLng(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 180;
}

/**
 * Parse GPX XML and return all track/route points and the bounding box.
 * Returns empty points and zero bounds on malformed GPX or parse error.
 */
export function extractPointsAndBounds(gpxText: string): GpxPointsAndBounds {
  if (typeof gpxText !== "string" || !gpxText.trim()) {
    return EMPTY;
  }

  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(gpxText, "text/xml");
  } catch {
    return EMPTY;
  }

  const points: Array<[number, number]> = [];
  let minLat = Infinity,
    minLng = Infinity,
    maxLat = -Infinity,
    maxLng = -Infinity;

  const trkpts = doc.querySelectorAll("trkpt");
  const rtepts = doc.querySelectorAll("rtept");
  const nodes = [...trkpts, ...rtepts];

  for (let i = 0; i < nodes.length; i++) {
    const pt = nodes[i];
    if (!pt) continue;
    const lat = parseFloatAttr(pt, "lat");
    const lon = parseFloatAttr(pt, "lon");
    if (!isFiniteCoord(lat) || !isFiniteLng(lon)) continue;
    points.push([lat, lon]);
    minLat = Math.min(minLat, lat);
    minLng = Math.min(minLng, lon);
    maxLat = Math.max(maxLat, lat);
    maxLng = Math.max(maxLng, lon);
  }

  if (points.length === 0) {
    return EMPTY;
  }

  const bounds: GpxBoundsLike = {
    south: minLat,
    west: minLng,
    north: maxLat,
    east: maxLng,
  };

  return { points, bounds };
}
