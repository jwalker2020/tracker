import along from "@turf/along";
import length from "@turf/length";
import { lineString } from "@turf/helpers";
import type { DemTileIndex, ElevationStats } from "./types";
import { findIntersectingTiles, boundsToWgs84Bbox } from "./intersect";
import { loadTileIndex } from "./tile-index";
import { DemRasterSampler } from "./sampler";
import { computeElevationStatsWithDistance, isValidElevation } from "./elevation-stats";
import { extractPointsAndBounds } from "./gpx-extract";

/** Resample track to this spacing (meters) before grade/elevation stats to reduce noise. */
const RESAMPLE_SPACING_M = 10;

const EMPTY_RESULT: ElevationEnrichmentResult = {
  stats: {
    minElevationM: 0,
    maxElevationM: 0,
    totalAscentM: 0,
    totalDescentM: 0,
    averageGradePct: 0,
    validCount: 0,
    totalCount: 0,
  },
  distanceM: 0,
  elevations: [],
};

export type DemEnrichmentConfig = {
  /** Path to folder containing DEM tiles (and manifest). */
  demBasePath: string;
  /** Optional path to manifest (default manifest.json). */
  manifestPath?: string;
};

/** Lightweight profile: cumulative distance (m) and elevation (m) per point. */
export type ElevationProfilePoint = { d: number; e: number };

export type ElevationEnrichmentResult = {
  stats: ElevationStats;
  /** Total horizontal distance in meters (from Turf length). */
  distanceM: number;
  /** Elevation per point (null = nodata/out of extent). */
  elevations: ReadonlyArray<number | null>;
  /** Optional profile for persistence. */
  profile?: ElevationProfilePoint[];
};

/**
 * Resample line to points at fixed spacing (meters). Returns [lat, lng][].
 * If length is 0 or spacing is 0, returns the line's first and last point if distinct.
 */
function resampleLineToFixedSpacing(
  lineFeature: ReturnType<typeof lineString>,
  totalLengthM: number,
  spacingM: number
): Array<[number, number]> {
  const coords = lineFeature.geometry.coordinates;
  if (!coords || coords.length === 0) return [];
  if (coords.length === 1) {
    const [lng, lat] = coords[0]!;
    return [[lat, lng]];
  }

  const safeSpacing = Number.isFinite(spacingM) && spacingM > 0 ? spacingM : RESAMPLE_SPACING_M;
  const safeLength = Number.isFinite(totalLengthM) && totalLengthM > 0 ? totalLengthM : 0;
  if (safeLength <= 0) {
    const [lng, lat] = coords[0]!;
    return [[lat, lng]];
  }

  const out: Array<[number, number]> = [];
  for (let d = 0; d <= safeLength; d += safeSpacing) {
    const pt = along(lineFeature, d, { units: "meters" });
    const [lng, lat] = pt.geometry.coordinates;
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      out.push([lat, lng]);
    }
  }
  const last = coords[coords.length - 1]!;
  const lastLat = last[1];
  const lastLng = last[0];
  if (out.length > 0 && (out[out.length - 1]![0] !== lastLat || out[out.length - 1]![1] !== lastLng)) {
    out.push([lastLat, lastLng]);
  }
  return out.length > 0 ? out : [[lastLat, lastLng]];
}

/**
 * Enrich a GPX with elevations from local DEM tiles and compute stats.
 * Resamples track to fixed spacing before grade calculation to reduce noise.
 */
export async function enrichGpxWithDem(
  gpxText: string,
  config: DemEnrichmentConfig
): Promise<ElevationEnrichmentResult> {
  const index = await loadTileIndex({
    demBasePath: config.demBasePath,
    manifestPath: config.manifestPath,
  });
  return enrichGpxWithDemFromIndex(gpxText, index);
}

/**
 * Enrich using a preloaded tile index (e.g. for tests or repeated use).
 */
export async function enrichGpxWithDemFromIndex(
  gpxText: string,
  index: DemTileIndex
): Promise<ElevationEnrichmentResult> {
  const { points, bounds } = extractPointsAndBounds(gpxText);
  if (points.length === 0) {
    return { ...EMPTY_RESULT };
  }

  const line = lineString(
    points.map(([lat, lng]) => [lng, lat])
  );
  const distanceM = length(line, { units: "meters" });
  const safeDistanceM = Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : 0;

  const bbox = boundsToWgs84Bbox(bounds);
  const tiles = findIntersectingTiles(index.tiles, bbox);

  if (tiles.length === 0) {
    const elevations: (number | null)[] = points.map(() => null);
    const stats = computeElevationStatsWithDistance(elevations, safeDistanceM);
    return { stats, distanceM: safeDistanceM, elevations };
  }

  const sampler = new DemRasterSampler(index.basePath);
  const openTiles: NonNullable<Awaited<ReturnType<DemRasterSampler["openTile"]>>>[] = [];
  for (const meta of tiles) {
    const open = await sampler.openTile(meta);
    if (open != null) openTiles.push(open);
  }

  if (openTiles.length === 0) {
    sampler.closeAll();
    const elevations: (number | null)[] = points.map(() => null);
    const stats = computeElevationStatsWithDistance(elevations, safeDistanceM);
    return { stats, distanceM: safeDistanceM, elevations };
  }

  const pointsToSample =
    safeDistanceM > 0 && points.length > 1
      ? resampleLineToFixedSpacing(line, safeDistanceM, RESAMPLE_SPACING_M)
      : points;

  const elevations: (number | null)[] = [];
  for (const [lat, lng] of pointsToSample) {
    let value: number | null = null;
    for (const open of openTiles) {
      const sample = await sampler.sample(open, lng, lat);
      if (sample.elevationM != null && isValidElevation(sample.elevationM)) {
        value = sample.elevationM;
        break;
      }
    }
    elevations.push(value);
  }

  sampler.closeAll();

  const stats = computeElevationStatsWithDistance(elevations, safeDistanceM);

  const profile: ElevationProfilePoint[] = [];
  const segmentLength = safeDistanceM / Math.max(1, pointsToSample.length - 1);
  let cumDist = 0;
  for (let i = 0; i < pointsToSample.length; i++) {
    if (i > 0) cumDist += segmentLength;
    const e = elevations[i];
    profile.push({
      d: Math.round(cumDist * 10) / 10,
      e: isValidElevation(e) ? Math.round(e * 10) / 10 : 0,
    });
  }

  return {
    stats,
    distanceM: safeDistanceM,
    elevations,
    profile: profile.length > 0 ? profile : undefined,
  };
}
