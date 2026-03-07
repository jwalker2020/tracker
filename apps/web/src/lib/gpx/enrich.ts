import { DOMParser } from "@xmldom/xmldom";
import { gpx as gpxToGeoJson } from "@tmcw/togeojson";
import bbox from "@turf/bbox";
import center from "@turf/center";
import length from "@turf/length";
import type { FeatureCollection, Feature, LineString, MultiLineString } from "geojson";
import type { GpxBounds } from "./parse";

export type EnrichedGpxResult = {
  bounds: GpxBounds;
  centerLat: number;
  centerLng: number;
  trackCount: number;
  pointCount: number;
  distanceM: number;
  minElevationM: number;
  maxElevationM: number;
  totalAscentM: number;
  totalDescentM: number;
  averageGradePct: number;
  enrichedGeoJson: string;
};

function bboxToBounds(turfBbox: number[]): GpxBounds {
  const [west, south, east, north] = turfBbox;
  return { south, west, north, east };
}

/** xmldom does not implement querySelectorAll/querySelector; use getElementsByTagName. */
function getElevationsFromDoc(doc: Document): number[] {
  const elevations: number[] = [];
  const trkpts = doc.getElementsByTagName("trkpt");
  const rtepts = doc.getElementsByTagName("rtept");
  function collect(list: { length: number; item(i: number): Element | null }): void {
    for (let i = 0; i < list.length; i++) {
      const pt = list.item(i);
      if (!pt) continue;
      const eleList = pt.getElementsByTagName("ele");
      const el = eleList.length > 0 ? eleList.item(0) : null;
      const text = el?.textContent?.trim();
      if (text) {
        const v = parseFloat(text);
        if (!Number.isNaN(v)) elevations.push(v);
      }
    }
  }
  collect(trkpts);
  collect(rtepts);
  return elevations;
}

function elevationStats(elevations: number[]): {
  minElevationM: number;
  maxElevationM: number;
  totalAscentM: number;
  totalDescentM: number;
} {
  if (elevations.length === 0) {
    return {
      minElevationM: 0,
      maxElevationM: 0,
      totalAscentM: 0,
      totalDescentM: 0,
    };
  }
  let min = Infinity;
  let max = -Infinity;
  let ascent = 0;
  let descent = 0;
  for (let i = 0; i < elevations.length; i++) {
    const e = elevations[i];
    min = Math.min(min, e);
    max = Math.max(max, e);
    if (i > 0) {
      const d = e - elevations[i - 1]!;
      if (d > 0) ascent += d;
      else descent += -d;
    }
  }
  return {
    minElevationM: min === Infinity ? 0 : min,
    maxElevationM: max === -Infinity ? 0 : max,
    totalAscentM: ascent,
    totalDescentM: descent,
  };
}

function totalLengthM(geojson: FeatureCollection): number {
  let total = 0;
  for (const f of geojson.features) {
    const feat = f as Feature<LineString | MultiLineString>;
    if (feat.geometry?.type === "LineString" || feat.geometry?.type === "MultiLineString") {
      total += length(feat, { units: "meters" });
    }
  }
  return total;
}

const EMPTY_RESULT: EnrichedGpxResult = {
  bounds: { south: 0, west: 0, north: 0, east: 0 },
  centerLat: 0,
  centerLng: 0,
  trackCount: 0,
  pointCount: 0,
  distanceM: 0,
  minElevationM: 0,
  maxElevationM: 0,
  totalAscentM: 0,
  totalDescentM: 0,
  averageGradePct: 0,
  enrichedGeoJson: JSON.stringify({ type: "FeatureCollection", features: [] }),
};

/**
 * Parse GPX to GeoJSON and compute derived stats (bbox, center, distance, elevation, grade).
 * Uses @tmcw/togeojson, @xmldom/xmldom, and Turf.
 */
export function enrichGpx(gpxText: string): EnrichedGpxResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "text/xml");

  const geojson = gpxToGeoJson(doc) as FeatureCollection;
  if (!geojson.features?.length) return EMPTY_RESULT;

  const turfBbox = bbox(geojson);
  const bounds = bboxToBounds(turfBbox);
  const centerFeature = center(geojson);
  const centerLat = centerFeature.geometry.coordinates[1] ?? 0;
  const centerLng = centerFeature.geometry.coordinates[0] ?? 0;

  const trackCount = geojson.features.filter(
    (f) =>
      (f as Feature<LineString | MultiLineString>).geometry?.type === "LineString" ||
      (f as Feature<LineString | MultiLineString>).geometry?.type === "MultiLineString"
  ).length;
  let pointCount = 0;
  for (const f of geojson.features) {
    const g = (f as Feature<LineString | MultiLineString>).geometry;
    if (g?.type === "LineString") pointCount += g.coordinates.length;
    if (g?.type === "MultiLineString")
      g.coordinates.forEach((line) => (pointCount += line.length));
  }

  const distanceM = totalLengthM(geojson);
  const elevations = getElevationsFromDoc(doc);
  const { minElevationM, maxElevationM, totalAscentM, totalDescentM } =
    elevationStats(elevations);
  const averageGradePct =
    distanceM > 0 ? (totalAscentM / distanceM) * 100 : 0;

  return {
    bounds,
    centerLat,
    centerLng,
    trackCount,
    pointCount,
    distanceM,
    minElevationM,
    maxElevationM,
    totalAscentM,
    totalDescentM,
    averageGradePct,
    enrichedGeoJson: JSON.stringify(geojson),
  };
}
