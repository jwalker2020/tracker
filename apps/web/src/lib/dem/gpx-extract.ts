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

/** Point: [lat, lng] or [lat, lng, ele]. Elevation in meters when present. */
export type GpxTrackPoint = [number, number, number?];

/** One track extracted from GPX (trk or rte), with stable index and bounds. */
export type ExtractedTrack = {
  trackIndex: number;
  name: string;
  points: GpxTrackPoint[];
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

/** First child element with local name matching (handles GPX 1.1 default namespace). */
function getFirstChildByLocalName(parent: Element, localName: string): Element | null {
  const name = localName.toLowerCase();
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n?.nodeType === 1) {
      const el = n as Element;
      if ((el.localName || el.nodeName).toLowerCase() === name) return el;
    }
  }
  return null;
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

  // xmldom does not implement querySelectorAll; use getElementsByTagName
  const trkpts = doc.getElementsByTagName("trkpt");
  const rtepts = doc.getElementsByTagName("rtept");

  function collectPoints(
    list: { length: number; item(i: number): Element | null }
  ): void {
    for (let i = 0; i < list.length; i++) {
      const pt = list.item(i);
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
  }
  collectPoints(trkpts);
  collectPoints(rtepts);

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

function computeBounds(points: GpxTrackPoint[]): GpxBoundsLike {
  if (points.length === 0) return { south: 0, west: 0, north: 0, east: 0 };
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const [lat, lon] of points) {
    if (isFiniteCoord(lat) && isFiniteLng(lon)) {
      minLat = Math.min(minLat, lat);
      minLng = Math.min(minLng, lon);
      maxLat = Math.max(maxLat, lat);
      maxLng = Math.max(maxLng, lon);
    }
  }
  return {
    south: Number.isFinite(minLat) ? minLat : 0,
    west: Number.isFinite(minLng) ? minLng : 0,
    north: Number.isFinite(maxLat) ? maxLat : 0,
    east: Number.isFinite(maxLng) ? maxLng : 0,
  };
}

/**
 * Extract tracks from GPX preserving order and identity. Each trk/rte becomes one ExtractedTrack.
 */
export function extractTracks(gpxText: string): ExtractedTrack[] {
  if (typeof gpxText !== "string" || !gpxText.trim()) return [];

  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(gpxText, "text/xml");
  } catch {
    return [];
  }

  const tracks: ExtractedTrack[] = [];
  let trackIndex = 0;

  const trks = doc.getElementsByTagName("trk");
  for (let i = 0; i < trks.length; i++) {
    const trk = trks.item(i);
    if (!trk) continue;
    const nameEl = trk.getElementsByTagName("name").item(0) ?? getFirstChildByLocalName(trk, "name");
    const name = (nameEl?.textContent ?? "").trim() || `Track ${trackIndex + 1}`;
    const trkpts = trk.getElementsByTagName("trkpt");
    const points: GpxTrackPoint[] = [];
    for (let j = 0; j < trkpts.length; j++) {
      const pt = trkpts.item(j);
      if (!pt) continue;
      const lat = parseFloatAttr(pt, "lat");
      const lon = parseFloatAttr(pt, "lon");
      if (!isFiniteCoord(lat) || !isFiniteLng(lon)) continue;
      const eleEl = pt.getElementsByTagName("ele").item(0) ?? getFirstChildByLocalName(pt, "ele");
      const ele = eleEl ? parseFloat((eleEl.textContent ?? "").trim()) : NaN;
      const hasEle = Number.isFinite(ele);
      points.push(hasEle ? [lat, lon, ele] : [lat, lon]);
    }
    if (points.length > 0) {
      tracks.push({ trackIndex, name, points, bounds: computeBounds(points) });
      trackIndex++;
    }
  }

  const rtes = doc.getElementsByTagName("rte");
  for (let i = 0; i < rtes.length; i++) {
    const rte = rtes.item(i);
    if (!rte) continue;
    const nameEl = rte.getElementsByTagName("name").item(0) ?? getFirstChildByLocalName(rte, "name");
    const name = (nameEl?.textContent ?? "").trim() || `Route ${trackIndex + 1}`;
    const rtepts = rte.getElementsByTagName("rtept");
    const points: GpxTrackPoint[] = [];
    for (let j = 0; j < rtepts.length; j++) {
      const pt = rtepts.item(j);
      if (!pt) continue;
      const lat = parseFloatAttr(pt, "lat");
      const lon = parseFloatAttr(pt, "lon");
      if (!isFiniteCoord(lat) || !isFiniteLng(lon)) continue;
      const eleEl = pt.getElementsByTagName("ele").item(0) ?? getFirstChildByLocalName(pt, "ele");
      const ele = eleEl ? parseFloat((eleEl.textContent ?? "").trim()) : NaN;
      const hasEle = Number.isFinite(ele);
      points.push(hasEle ? [lat, lon, ele] : [lat, lon]);
    }
    if (points.length > 0) {
      tracks.push({ trackIndex, name, points, bounds: computeBounds(points) });
      trackIndex++;
    }
  }

  return tracks;
}
