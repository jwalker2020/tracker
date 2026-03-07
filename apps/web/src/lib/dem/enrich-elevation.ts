import length from "@turf/length";
import { lineString } from "@turf/helpers";
import type { DemTileIndex, ElevationStats } from "./types";
import { findIntersectingTiles, boundsToWgs84Bbox } from "./intersect";
import { loadTileIndex } from "./tile-index";
import { DemRasterSampler } from "./sampler";
import { computeElevationStatsWithDistance } from "./elevation-stats";
import { extractPointsAndBounds } from "./gpx-extract";

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
  /** Elevation per point (null if nodata/out of extent). */
  elevations: ReadonlyArray<number | null>;
  /** Optional profile for persistence: [{ d: distanceM, e: elevationM }, ...]. */
  profile?: ElevationProfilePoint[];
};

/**
 * Enrich a GPX with elevations from local DEM tiles and compute stats.
 * Reusable pipeline: parse GPX → bbox → find tiles → open once → sample each point → aggregate.
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
    return {
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
  }

  const line = lineString(
    points.map(([lat, lng]) => [lng, lat])
  );
  const distanceM = length(line, { units: "meters" });

  const bbox = boundsToWgs84Bbox(bounds);
  const tiles = findIntersectingTiles(index.tiles, bbox);
  if (tiles.length === 0) {
    const elevations: (number | null)[] = points.map(() => null);
    const stats = computeElevationStatsWithDistance(elevations, distanceM);
    return { stats, distanceM, elevations };
  }

  const sampler = new DemRasterSampler(index.basePath);
  const openTiles: NonNullable<Awaited<ReturnType<DemRasterSampler["openTile"]>>>[] = [];
  for (const meta of tiles) {
    const open = await sampler.openTile(meta);
    if (open != null) openTiles.push(open);
  }

  const elevations: (number | null)[] = [];
  for (const [lat, lng] of points) {
    let value: number | null = null;
    for (const open of openTiles) {
      const sample = await sampler.sample(open, lng, lat);
      if (sample.elevationM != null) {
        value = sample.elevationM;
        break;
      }
    }
    elevations.push(value);
  }

  sampler.closeAll();

  const stats = computeElevationStatsWithDistance(
    elevations,
    distanceM
  );

  const profile: ElevationProfilePoint[] = [];
  let cumDist = 0;
  const segmentLength = distanceM / Math.max(1, points.length - 1);
  for (let i = 0; i < points.length; i++) {
    if (i > 0) cumDist += segmentLength;
    const e = elevations[i];
    profile.push({ d: Math.round(cumDist * 10) / 10, e: e != null ? Math.round(e * 10) / 10 : 0 });
  }

  return { stats, distanceM, elevations, profile };
}
