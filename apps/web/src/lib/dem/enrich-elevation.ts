import along from "@turf/along";
import length from "@turf/length";
import { lineString } from "@turf/helpers";
import type { DemTileIndex, ElevationStats, Wgs84Bbox } from "./types";
import { findIntersectingTiles, boundsToWgs84Bbox, tileBboxIntersectsTrackBbox } from "./intersect";
import { loadTileIndex } from "./tile-index";
import { DemRasterSampler } from "./sampler";
import {
  computeElevationStatsWithDistance,
  ELEVATION_CHANGE_THRESHOLD_M,
  ELEVATION_SMOOTH_WINDOW_SIZE,
  isValidElevation,
  mergeChunkElevationState,
  smoothElevationSeriesMedian,
  type AccumulatedElevationState,
} from "./elevation-stats";
import type { EnrichedTrackSummary } from "./types";
import { extractPointsAndBounds, extractTracks } from "./gpx-extract";

/** Resample track to this spacing (meters) before grade/elevation stats. Finer spacing captures more ascent/descent; coarser smooths noise. */
const RESAMPLE_SPACING_M = 5;

const EMPTY_RESULT: ElevationEnrichmentResult = {
  stats: {
    minElevationM: 0,
    maxElevationM: 0,
    totalAscentM: 0,
    totalDescentM: 0,
    averageGradePct: 0,
    averageSteepnessPct: 0,
    validCount: 0,
    totalCount: 0,
  },
  distanceM: 0,
  elevations: [],
};

export type DemEnrichmentProgressCallback = (data: {
  processedPoints: number;
  totalPoints: number;
  percentComplete: number;
}) => void;

/** Resume state from a saved checkpoint (lightweight, no full point arrays). */
export type EnrichmentResumeState = {
  nextPointIndex: number;
  totalPoints: number;
  distanceM: number;
  chunkSize: number;
  accumulatedState: AccumulatedElevationState;
  /** Downsampled profile points accumulated so far. */
  profileSoFar: ElevationProfilePoint[];
};

/** Payload passed to onCheckpoint after each chunk (for persistence). */
export type EnrichmentCheckpointPayload = {
  totalPoints: number;
  processedPoints: number;
  nextPointIndex: number;
  minElevationM: number | null;
  maxElevationM: number | null;
  totalAscentM: number;
  totalDescentM: number;
  distanceM: number;
  priorElevationM: number | null;
  validCount: number;
  profileJson: string | null;
};

export type DemEnrichmentConfig = {
  /** Path to folder containing DEM tiles (and manifest). Omit or empty = use only GPX elevation (no DEM). */
  demBasePath?: string;
  /** Optional path to manifest (default manifest.json). */
  manifestPath?: string;
  /** Optional progress callback during sampling (processedPoints, totalPoints, percentComplete). */
  onProgress?: DemEnrichmentProgressCallback;
  /** Optional resume state from a saved checkpoint. */
  resumeState?: EnrichmentResumeState;
  /** Optional checkpoint callback; called after each chunk with payload to persist. */
  onCheckpoint?: (payload: EnrichmentCheckpointPayload) => void | Promise<void>;
  /** Optional; when true, the pipeline should exit cleanly without writing results. Sync or async. */
  isCancelled?: () => boolean | Promise<boolean>;
  /** When set, called after each track with its summary; pipeline does not retain full enrichedTracks array (memory-safe). */
  onTrackComplete?: (summary: EnrichedTrackSummary) => void;
};

/** Lightweight profile: cumulative distance (m), elevation (m), and map coords per point. */
export type ElevationProfilePoint = { d: number; e: number; lat: number; lng: number };

/** Optional per-track timing for instrumentation (not part of API output). */
export type EnrichmentTiming = {
  resampleMs: number;
  resampleInputPoints: number;
  resampleOutputPoints: number;
  resampleSpacingM: number;
  resampleSkipped: boolean;
  smoothMs: number;
  statsMs: number;
  postSampleMs: number;
};

export type ElevationEnrichmentResult = {
  stats: ElevationStats;
  /** Total horizontal distance in meters (from Turf length). Internal; convert to feet for display. */
  distanceM: number;
  /** Elevation per point (null = nodata/out of extent). */
  elevations: ReadonlyArray<number | null>;
  /** Optional profile for persistence. */
  profile?: ElevationProfilePoint[];
  /** Set when validCount is 0 so API can return a specific reason. */
  elevationHint?: "no_intersecting_tiles" | "no_open_tiles" | "all_nodata";
  /** Optional timing for instrumentation; not persisted to API. */
  _timing?: EnrichmentTiming;
};

const YIELD_EVERY_N_POINTS = 200;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export type ResampleResult = {
  points: Array<[number, number]>;
  inputPoints: number;
  outputPoints: number;
  spacingM: number;
};

/**
 * Resample line to points at fixed spacing (meters). Uses cumulative segment distances
 * and linear interpolation for O(segments + output) cost instead of O(output * segments) with Turf along().
 * Returns points as [lat, lng][] and stats for instrumentation.
 * Falls back to Turf along() when segment list is very small or distances are degenerate.
 */
async function resampleLineToFixedSpacing(
  lineFeature: ReturnType<typeof lineString>,
  totalLengthM: number,
  spacingM: number,
  onProgress?: (processed: number, estimatedTotal: number) => void | Promise<void>
): Promise<ResampleResult> {
  const coords = lineFeature.geometry.coordinates;
  const inputPoints = coords?.length ?? 0;
  if (!coords || coords.length === 0) {
    return { points: [], inputPoints: 0, outputPoints: 0, spacingM: spacingM };
  }
  if (coords.length === 1) {
    const [lng, lat] = coords[0]!;
    return { points: [[lat, lng]], inputPoints: 1, outputPoints: 1, spacingM: spacingM };
  }

  const safeSpacing = Number.isFinite(spacingM) && spacingM > 0 ? spacingM : RESAMPLE_SPACING_M;
  const safeLength = Number.isFinite(totalLengthM) && totalLengthM > 0 ? totalLengthM : 0;
  if (safeLength <= 0) {
    const [lng, lat] = coords[0]!;
    return { points: [[lat, lng]], inputPoints, outputPoints: 1, spacingM: safeSpacing };
  }

  const n = coords.length;
  const cumDist: number[] = new Array(n);
  cumDist[0] = 0;
  for (let i = 1; i < n; i++) {
    const seg = lineString([coords[i - 1]!, coords[i]!]);
    const segLen = length(seg, { units: "meters" });
    const add = Number.isFinite(segLen) && segLen >= 0 ? segLen : 0;
    cumDist[i] = cumDist[i - 1]! + add;
  }
  const totalFromSegments = cumDist[n - 1]!;
  if (totalFromSegments <= 0 && safeLength > 0) {
    return resampleLineToFixedSpacingTurf(
      lineFeature,
      totalLengthM,
      spacingM,
      onProgress
    );
  }
  const useLength = totalFromSegments > 0 ? totalFromSegments : safeLength;

  const estimatedTotal = Math.max(1, Math.ceil(useLength / safeSpacing) + 1);
  const out: Array<[number, number]> = [];
  let segmentIndex = 0;

  for (let d = 0; d <= useLength; d += safeSpacing) {
    if (d >= useLength) {
      const last = coords[n - 1]!;
      out.push([last[1], last[0]]);
      break;
    }
    while (segmentIndex < n - 1 && cumDist[segmentIndex + 1]! <= d) {
      segmentIndex++;
    }
    if (segmentIndex >= n - 1) {
      const last = coords[n - 1]!;
      out.push([last[1], last[0]]);
      break;
    }
    const d0 = cumDist[segmentIndex]!;
    const d1 = cumDist[segmentIndex + 1]!;
    const segLen = d1 - d0;
    const t = segLen > 0 ? (d - d0) / segLen : 0;
    const a = coords[segmentIndex]!;
    const b = coords[segmentIndex + 1]!;
    const lng = a[0] + t * (b[0] - a[0]);
    const lat = a[1] + t * (b[1] - a[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      out.push([lat, lng]);
    }
    if (onProgress && out.length % YIELD_EVERY_N_POINTS === 0) {
      await onProgress(out.length, estimatedTotal);
      await yieldToEventLoop();
    }
  }

  const last = coords[n - 1]!;
  const lastLat = last[1];
  const lastLng = last[0];
  if (out.length > 0 && (out[out.length - 1]![0] !== lastLat || out[out.length - 1]![1] !== lastLng)) {
    out.push([lastLat, lastLng]);
  }
  const points: Array<[number, number]> = out.length > 0 ? out : [[lastLat, lastLng]];
  return {
    points,
    inputPoints,
    outputPoints: points.length,
    spacingM: safeSpacing,
  };
}

/**
 * Fallback: Turf along() per distance. Used when linear-interp path is not suitable (e.g. degenerate segments).
 */
async function resampleLineToFixedSpacingTurf(
  lineFeature: ReturnType<typeof lineString>,
  totalLengthM: number,
  spacingM: number,
  onProgress?: (processed: number, estimatedTotal: number) => void | Promise<void>
): Promise<ResampleResult> {
  const coords = lineFeature.geometry.coordinates;
  const inputPoints = coords?.length ?? 0;
  if (!coords || coords.length === 0) {
    return { points: [], inputPoints: 0, outputPoints: 0, spacingM: spacingM };
  }
  if (coords.length === 1) {
    const [lng, lat] = coords[0]!;
    return { points: [[lat, lng]], inputPoints: 1, outputPoints: 1, spacingM: spacingM };
  }

  const safeSpacing = Number.isFinite(spacingM) && spacingM > 0 ? spacingM : RESAMPLE_SPACING_M;
  const safeLength = Number.isFinite(totalLengthM) && totalLengthM > 0 ? totalLengthM : 0;
  if (safeLength <= 0) {
    const [lng, lat] = coords[0]!;
    return { points: [[lat, lng]], inputPoints, outputPoints: 1, spacingM: safeSpacing };
  }

  const estimatedTotal = Math.max(1, Math.ceil(safeLength / safeSpacing) + 1);
  const out: Array<[number, number]> = [];
  for (let d = 0; d <= safeLength; d += safeSpacing) {
    const pt = along(lineFeature, d, { units: "meters" });
    const [lng, lat] = pt.geometry.coordinates;
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      out.push([lat, lng]);
      if (onProgress && out.length % YIELD_EVERY_N_POINTS === 0) {
        await onProgress(out.length, estimatedTotal);
        await yieldToEventLoop();
      }
    }
  }
  const last = coords[coords.length - 1]!;
  const lastLat = last[1];
  const lastLng = last[0];
  if (out.length > 0 && (out[out.length - 1]![0] !== lastLat || out[out.length - 1]![1] !== lastLng)) {
    out.push([lastLat, lastLng]);
  }
  const pointsTurf: Array<[number, number]> = out.length > 0 ? out : [[lastLat, lastLng]];
  return {
    points: pointsTurf,
    inputPoints,
    outputPoints: pointsTurf.length,
    spacingM: safeSpacing,
  };
}

/**
 * Enrich a GPX with elevations from local DEM tiles and compute stats.
 * Resamples track to fixed spacing before grade calculation to reduce noise.
 */
export async function enrichGpxWithDem(
  gpxText: string,
  config: DemEnrichmentConfig
): Promise<ElevationEnrichmentResult> {
  const demBasePath = config.demBasePath?.trim();
  if (!demBasePath) {
    throw new Error("demBasePath is required for enrichGpxWithDem");
  }
  const index = await loadTileIndex({
    demBasePath,
    manifestPath: config.manifestPath,
  });
  return enrichGpxWithDemFromIndex(gpxText, index, {
    onProgress: config.onProgress,
    resumeState: config.resumeState,
    onCheckpoint: config.onCheckpoint,
  });
}

const CHUNK_SIZE = 10_000;

function safeDivide(num: number, denom: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return 0;
  const q = num / denom;
  return Number.isFinite(q) ? q : 0;
}

type OpenTileT = NonNullable<Awaited<ReturnType<DemRasterSampler["openTile"]>>>;

type EnrichFromIndexOptions = {
  onProgress?: DemEnrichmentProgressCallback;
  resumeState?: EnrichmentResumeState;
  onCheckpoint?: (payload: EnrichmentCheckpointPayload) => void | Promise<void>;
  /** When set, use this sampler and do not close it (caller owns lifecycle). Enables tile cache reuse across tracks. */
  sharedSampler?: DemRasterSampler;
  /** When set, use these open tiles and skip findIntersectingTiles + openTile loop (reduces per-track overhead after preload). */
  preloadedOpenTiles?: OpenTileT[];
  /** Optional; when true, stop processing and exit cleanly. Sync or async. */
  isCancelled?: () => boolean | Promise<boolean>;
};

/** Point with optional elevation: [lat, lng] or [lat, lng, ele]. */
type PointWithOptionalEle = [number, number, number?];

/** True if point has valid GPX elevation (meters). */
function hasGpxElevation(p: PointWithOptionalEle): boolean {
  return p.length >= 3 && typeof p[2] === "number" && Number.isFinite(p[2]);
}

/**
 * Cumulative distance (m) from start to each point along the line. Handles duplicate consecutive
 * points (zero-length segments) safely. Result[i] = distance from point 0 to point i; result[0] = 0.
 */
function cumulativeDistancesAlongLine(points: PointWithOptionalEle[]): number[] {
  const n = points.length;
  const out: number[] = new Array(n);
  if (n === 0) return out;
  out[0] = 0;
  for (let i = 1; i < n; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = lineString([
      [a[1], a[0]],
      [b[1], b[0]],
    ]);
    const segLen = length(seg, { units: "meters" });
    const add = Number.isFinite(segLen) && segLen >= 0 ? segLen : 0;
    out[i] = out[i - 1]! + add;
  }
  return out;
}

/**
 * Enrich a single track using only GPX geometry and elevation (no DEM).
 * Uses cumulative distance along raw points; handles duplicate consecutive points (zero-length segments).
 * Elevation from GPX when present; missing elevation stays null (stats still computed from valid points).
 */
function enrichSingleTrackGpxOnly(
  points: PointWithOptionalEle[],
  _bounds: { south: number; west: number; north: number; east: number }
): ElevationEnrichmentResult {
  if (points.length === 0) return { ...EMPTY_RESULT };

  const cumulativeDistM = cumulativeDistancesAlongLine(points);
  const safeDistanceM =
    cumulativeDistM.length > 0 && Number.isFinite(cumulativeDistM[cumulativeDistM.length - 1]!)
      ? Math.max(0, cumulativeDistM[cumulativeDistM.length - 1]!)
      : 0;

  const elevations: (number | null)[] = points.map((p) =>
    hasGpxElevation(p) ? (p[2] as number) : null
  );
  const validCount = elevations.filter((e) => e != null && Number.isFinite(e)).length;

  const profileSoFar: ElevationProfilePoint[] = points.map((p, i) => ({
    d: Math.round((cumulativeDistM[i] ?? 0) * 10) / 10,
    e: elevations[i] != null && Number.isFinite(elevations[i]) ? Math.round(elevations[i]! * 10) / 10 : 0,
    lat: p[0],
    lng: p[1],
  }));

  const rawElevations = profileSoFar.map((p) => p.e);
  const smoothedElevations =
    rawElevations.length > 0
      ? smoothElevationSeriesMedian(rawElevations, ELEVATION_SMOOTH_WINDOW_SIZE)
      : [];
  const statsFromSmoothed =
    smoothedElevations.length > 0
      ? computeElevationStatsWithDistance(smoothedElevations, safeDistanceM, {
          ascentDescentThresholdM: ELEVATION_CHANGE_THRESHOLD_M,
        })
      : null;

  const stats: ElevationStats = statsFromSmoothed
    ? {
        ...statsFromSmoothed,
        totalCount: points.length,
        validCount,
      }
    : {
        minElevationM: 0,
        maxElevationM: 0,
        totalAscentM: 0,
        totalDescentM: 0,
        averageGradePct: 0,
        averageSteepnessPct: 0,
        validCount: 0,
        totalCount: points.length,
      };

  const profileForReturn: ElevationProfilePoint[] =
    smoothedElevations.length > 0 && smoothedElevations.length === profileSoFar.length
      ? profileSoFar.map((p, i) => ({ ...p, e: smoothedElevations[i]! }))
      : profileSoFar;

  return {
    stats,
    distanceM: safeDistanceM,
    elevations: [],
    profile: profileForReturn.length > 0 ? profileForReturn : undefined,
  };
}

/** Return the first open tile whose bbox contains (lng, lat), or null. */
function findTileContainingPoint(
  openTiles: NonNullable<Awaited<ReturnType<DemRasterSampler["openTile"]>>>[],
  lng: number,
  lat: number
): (NonNullable<Awaited<ReturnType<DemRasterSampler["openTile"]>>>) | null {
  for (let t = 0; t < openTiles.length; t++) {
    const open = openTiles[t]!;
    const [west, south, east, north] = open.meta.bbox;
    if (lng >= west && lng <= east && lat >= south && lat <= north) return open;
  }
  return null;
}

/**
 * Enrich a single track (points + bounds) with DEM. Used by both whole-GPX and per-track flows.
 * Supports resume and checkpoint when options are provided.
 * Points may include optional elevation ([lat, lng, ele]); when valid, DEM sampling is skipped for that point.
 */
export async function enrichSingleTrackFromIndex(
  points: PointWithOptionalEle[],
  bounds: { south: number; west: number; north: number; east: number },
  index: DemTileIndex,
  options?: EnrichFromIndexOptions
): Promise<ElevationEnrichmentResult> {
  const onProgress = options?.onProgress;
  const resumeState = options?.resumeState;
  const onCheckpoint = options?.onCheckpoint;

  if (points.length === 0) return { ...EMPTY_RESULT };

  const line = lineString(points.map((p) => [p[1], p[0]]));
  const distanceM = length(line, { units: "meters" });
  const safeDistanceM = Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : 0;
  const anyGpxEle = points.some(hasGpxElevation);
  const bbox = boundsToWgs84Bbox(bounds);
  const sampler = options?.sharedSampler ?? new DemRasterSampler(index.basePath);
  let openTiles: OpenTileT[];
  let findTilesMs: number;
  let tileOpenMs: number;

  if (options?.preloadedOpenTiles?.length) {
    const findTilesStart = Date.now();
    openTiles = options.preloadedOpenTiles.filter((open) =>
      tileBboxIntersectsTrackBbox(open.meta.bbox, bbox)
    );
    findTilesMs = Date.now() - findTilesStart;
    tileOpenMs = 0;
  } else {
    const findTilesStart = Date.now();
    const tiles = findIntersectingTiles(index.tiles, bbox);
    findTilesMs = Date.now() - findTilesStart;
    if (tiles.length === 0) {
      if (!anyGpxEle) {
        console.warn(
          "[DEM] No tiles intersect GPX bbox [west,south,east,north]:",
          bbox.map((n) => Number(n).toFixed(4)),
          "| Index has",
          index.tiles.length,
          "tiles. Is the track inside your DEM coverage (e.g. New Hampshire)?"
        );
        const elevations: (number | null)[] = points.map(() => null);
        const stats = computeElevationStatsWithDistance(elevations, safeDistanceM);
        return { stats, distanceM: safeDistanceM, elevations, elevationHint: "no_intersecting_tiles" as const };
      }
    }
    openTiles = [];
    if (tiles.length > 0) {
      const t0 = Date.now();
      for (const meta of tiles) {
        const open = await sampler.openTile(meta);
        if (open != null) openTiles.push(open);
      }
      tileOpenMs = Date.now() - t0;
    } else {
      tileOpenMs = 0;
    }
  }

  if (openTiles.length === 0 && !anyGpxEle) {
    console.warn(
      "[DEM] No tile files could be opened for this track's bbox. DEM_BASE_PATH=",
      index.basePath || "(empty!)",
      "| index has",
      index.tiles.length,
      "tiles."
    );
    if (!options?.sharedSampler) sampler.closeAll();
    const elevations: (number | null)[] = points.map(() => null);
    const stats = computeElevationStatsWithDistance(elevations, safeDistanceM);
    return { stats, distanceM: safeDistanceM, elevations, elevationHint: "no_open_tiles" as const };
  }

  /** When any point has valid GPX elevation, use raw points so we preserve it; no resampling. */
  const useRawPoints = anyGpxEle;
  if (anyGpxEle) {
    const gpxEleCount = points.filter(hasGpxElevation).length;
    try {
      process.stderr.write(`[DEM] Using GPX elevation for ${gpxEleCount}/${points.length} points; DEM only for missing.\n`);
    } catch {
      console.warn("[DEM] Using GPX elevation for", gpxEleCount, "/", points.length, "points; DEM only for missing.");
    }
  }
  const estimatedTotal = useRawPoints
    ? points.length
    : Math.max(
        1,
        safeDistanceM > 0 && points.length > 1
          ? Math.ceil(safeDistanceM / RESAMPLE_SPACING_M) + 1
          : points.length
      );
  if (onProgress) {
    onProgress({ processedPoints: 0, totalPoints: estimatedTotal, percentComplete: 0 });
  }

  /** Points to sample: raw (with optional ele) when GPX has elevation, else resampled. */
  const resampleStartMs = Date.now();
  let pointsToSample: PointWithOptionalEle[];
  let resampleMs: number;
  let resampleInputPoints: number;
  let resampleOutputPoints: number;
  let resampleSpacingM: number;
  let resampleSkipped: boolean;

  if (useRawPoints) {
    pointsToSample = points;
    resampleMs = 0;
    resampleInputPoints = points.length;
    resampleOutputPoints = points.length;
    resampleSpacingM = RESAMPLE_SPACING_M;
    resampleSkipped = true;
  } else if (safeDistanceM > 0 && points.length > 1) {
    const resampleResult = await resampleLineToFixedSpacing(
      line,
      safeDistanceM,
      RESAMPLE_SPACING_M,
      (processed, total) => {
        if (onProgress) {
          const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
          onProgress({ processedPoints: processed, totalPoints: total, percentComplete: pct });
        }
      }
    );
    pointsToSample = resampleResult.points;
    resampleMs = Date.now() - resampleStartMs;
    resampleInputPoints = resampleResult.inputPoints;
    resampleOutputPoints = resampleResult.outputPoints;
    resampleSpacingM = resampleResult.spacingM;
    resampleSkipped = false;
  } else {
    pointsToSample = points;
    resampleMs = 0;
    resampleInputPoints = points.length;
    resampleOutputPoints = points.length;
    resampleSpacingM = RESAMPLE_SPACING_M;
    resampleSkipped = true;
  }

  const totalPoints = pointsToSample.length;
  const cumulativeDistM = useRawPoints ? cumulativeDistancesAlongLine(pointsToSample) : null;
  const segmentLength = cumulativeDistM
    ? 0
    : safeDistanceM / Math.max(1, totalPoints - 1);

  let startIndex = 0;
  let accumulatedState: AccumulatedElevationState;
  let profileSoFar: ElevationProfilePoint[];

  if (resumeState && resumeState.nextPointIndex > 0 && resumeState.nextPointIndex < totalPoints) {
    startIndex = resumeState.nextPointIndex;
    accumulatedState = { ...resumeState.accumulatedState };
    profileSoFar = [...resumeState.profileSoFar];
  } else {
    accumulatedState = {
      minElevationM: 0,
      maxElevationM: 0,
      totalAscentM: 0,
      totalDescentM: 0,
      validCount: 0,
      priorElevationM: null,
    };
    profileSoFar = [];
  }

  const latestProgress = { processedPoints: startIndex, totalPoints, percentComplete: 0 };
  const reportProgress = (processed: number): void => {
    const pct = totalPoints > 0 ? Math.min(100, Math.round((processed / totalPoints) * 100)) : 0;
    latestProgress.processedPoints = processed;
    latestProgress.percentComplete = pct;
    if (onProgress) {
      onProgress({ processedPoints: processed, totalPoints, percentComplete: pct });
    }
  };
  reportProgress(startIndex);

  const startTimeMs = Date.now();
  const LOG_INTERVAL_MS = 10_000;
  const demLog = (msg: string): void => {
    try {
      process.stderr.write(`[DEM] ${msg}\n`);
    } catch {
      console.warn("[DEM]", msg);
    }
  };
  const formatHhMmSs = (totalSeconds: number): string => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const logProgress = (): void => {
    const { processedPoints, totalPoints: total, percentComplete } = latestProgress;
    const elapsedMs = Date.now() - startTimeMs;
    const elapsedSec = Math.floor(elapsedMs / 1000);
    let estimatedRemaining = "";
    if (processedPoints > 0 && processedPoints < total) {
      const ratePerSec = processedPoints / (elapsedMs / 1000);
      const remainingSec = Math.round((total - processedPoints) / ratePerSec);
      estimatedRemaining = formatHhMmSs(remainingSec);
    }
    demLog(
      "Enrichment progress\n" +
        `  Processed: ${processedPoints.toLocaleString()} / ${total.toLocaleString()} points (${percentComplete}%)\n` +
        `  Elapsed: ${formatHhMmSs(elapsedSec)}\n` +
        (estimatedRemaining ? `  Estimated remaining: ${estimatedRemaining}` : "")
    );
  };
  const progressLogIntervalId = setInterval(logProgress, LOG_INTERVAL_MS);

  const progressInterval = Math.max(1, Math.floor(totalPoints / 100));

  const samplingStartMs = Date.now();
  const readRasterCallsAtStart = sampler.getStats().readRasterCalls;
  let fallbackCount = 0;
  let cancelled = false;

  try {
    for (let chunkStart = startIndex; chunkStart < totalPoints; chunkStart += CHUNK_SIZE) {
      const c = options?.isCancelled?.();
      const cancelledThisChunk = await Promise.resolve(c);
      if (cancelledThisChunk) {
        cancelled = true;
        break;
      }
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalPoints);
      const chunkLen = chunkEnd - chunkStart;
      const chunkElevations: (number | null)[] = new Array(chunkLen);
      const pointsWithGpx = new Set<number>();

      // Group points that need DEM by containing tile; fill GPX elevations.
      const byTile = new Map<OpenTileT, { indices: number[]; lngs: number[]; lats: number[] }>();
      let lastUsedTile: OpenTileT | null = null;
      for (let i = chunkStart; i < chunkEnd; i++) {
        const pt = pointsToSample[i]!;
        const lat = pt[0];
        const lng = pt[1];
        const rawEle = pt.length >= 3 ? pt[2] : undefined;
        const hasValidEle =
          typeof rawEle === "number" && Number.isFinite(rawEle);
        const chunkIdx = i - chunkStart;
        if (hasValidEle) {
          chunkElevations[chunkIdx] = rawEle as number;
          pointsWithGpx.add(chunkIdx);
          continue;
        }
        const bboxLast: [number, number, number, number] =
          lastUsedTile?.meta.bbox ?? [0, 0, 0, 0];
        const [w, s, e, n] = bboxLast;
        const inLast: boolean =
          lastUsedTile != null && lng >= w && lng <= e && lat >= s && lat <= n;
        const tile: OpenTileT | null = inLast
          ? lastUsedTile
          : findTileContainingPoint(openTiles, lng, lat);
        if (tile) {
          lastUsedTile = tile;
          let entry = byTile.get(tile);
          if (!entry) {
            entry = { indices: [], lngs: [], lats: [] };
            byTile.set(tile, entry);
          }
          entry.indices.push(chunkIdx);
          entry.lngs.push(lng);
          entry.lats.push(lat);
        }
      }

      // Batch sample per tile (one readRasters per tile).
      let tileIndex = 0;
      for (const [tile, { indices, lngs, lats }] of byTile) {
        if (tileIndex > 0 && tileIndex % 10 === 0) {
          const c = options?.isCancelled?.();
          const cancelledNow = await Promise.resolve(c);
          if (cancelledNow) {
            cancelled = true;
            break;
          }
        }
        tileIndex++;
        const elevations = await sampler.samplePointsInTile(tile, lngs, lats);
        for (let j = 0; j < indices.length; j++) {
          const v = elevations[j];
          if (v != null && isValidElevation(v)) {
            chunkElevations[indices[j]!] = v;
          }
        }
      }
      if (cancelled) break;

      if (!cancelled) {
        // Fallback: points still null (tile boundary, nodata, or batch window skipped) — try other tiles one-by-one.
        for (let chunkIdx = 0; chunkIdx < chunkLen; chunkIdx++) {
          if (pointsWithGpx.has(chunkIdx) || chunkElevations[chunkIdx] != null) continue;
          const pt = pointsToSample[chunkStart + chunkIdx]!;
          const lng = pt[1];
          const lat = pt[0];
          for (const open of openTiles) {
            const sample = await sampler.sample(open, lng, lat);
            if (sample.elevationM != null && isValidElevation(sample.elevationM)) {
              chunkElevations[chunkIdx] = sample.elevationM;
              fallbackCount++;
              break;
            }
          }
        }

        // Build profile and report progress (same order as before).
        for (let i = chunkStart; i < chunkEnd; i++) {
          const chunkIdx = i - chunkStart;
          const value = chunkElevations[chunkIdx];
          const pt = pointsToSample[i]!;
          const lat = pt[0];
          const lng = pt[1];
          const cumDist =
            cumulativeDistM != null
              ? Math.round((cumulativeDistM[i] ?? 0) * 10) / 10
              : Math.round((i * segmentLength) * 10) / 10;
          const e = value != null ? Math.round(value * 10) / 10 : 0;
          profileSoFar.push({ d: cumDist, e, lat, lng });

          const processed = i + 1;
          if (processed % progressInterval === 0 || processed === totalPoints) {
            reportProgress(processed);
          }
        }
      }

      if (cancelled) break;

      accumulatedState = mergeChunkElevationState(accumulatedState, chunkElevations);

      const payload: EnrichmentCheckpointPayload = {
        totalPoints,
        processedPoints: chunkEnd,
        nextPointIndex: chunkEnd,
        minElevationM: accumulatedState.validCount > 0 ? accumulatedState.minElevationM : null,
        maxElevationM: accumulatedState.validCount > 0 ? accumulatedState.maxElevationM : null,
        totalAscentM: accumulatedState.totalAscentM,
        totalDescentM: accumulatedState.totalDescentM,
        distanceM: safeDistanceM,
        priorElevationM: accumulatedState.priorElevationM,
        validCount: accumulatedState.validCount,
        profileJson: profileSoFar.length > 0 ? JSON.stringify(profileSoFar) : null,
      };
      if (onCheckpoint) {
        void Promise.resolve(onCheckpoint(payload));
      }
    }
  } finally {
    clearInterval(progressLogIntervalId);
  }

  if (cancelled) {
    if (!options?.sharedSampler) sampler.closeAll();
    throw new Error("ENRICHMENT_CANCELLED");
  }

  const samplingMs = Date.now() - samplingStartMs;
  const readsThisTrack = sampler.getStats().readRasterCalls - readRasterCallsAtStart;
  const resampleInfo = resampleSkipped
    ? "resample=skipped"
    : `resample=${resampleMs}ms in=${resampleInputPoints} out=${resampleOutputPoints} spacing=${resampleSpacingM}m`;

  if (!options?.sharedSampler) sampler.closeAll();

  // Use smoothed elevation series for stats and profile display to reduce DEM/GPS noise.
  // Raw profile is kept in profileSoFar for debugging; we derive smoothed profile and stats from it.
  const postSampleStartMs = Date.now();
  const rawElevations = profileSoFar.map((p) => p.e);
  const smoothStartMs = Date.now();
  const smoothedElevations =
    rawElevations.length > 0
      ? smoothElevationSeriesMedian(rawElevations, ELEVATION_SMOOTH_WINDOW_SIZE)
      : [];
  const smoothMs = Date.now() - smoothStartMs;
  const statsStartMs = Date.now();
  const statsFromSmoothed =
    smoothedElevations.length > 0
      ? computeElevationStatsWithDistance(smoothedElevations, safeDistanceM, {
          ascentDescentThresholdM: ELEVATION_CHANGE_THRESHOLD_M,
        })
      : null;
  const statsMs = Date.now() - statsStartMs;

  const stats: ElevationStats = statsFromSmoothed
    ? {
        ...statsFromSmoothed,
        totalCount: totalPoints,
        validCount: accumulatedState.validCount,
      }
    : {
        minElevationM: accumulatedState.minElevationM,
        maxElevationM: accumulatedState.maxElevationM,
        totalAscentM: accumulatedState.totalAscentM,
        totalDescentM: accumulatedState.totalDescentM,
        averageGradePct: 0,
        averageSteepnessPct: 0,
        validCount: accumulatedState.validCount,
        totalCount: totalPoints,
      };

  const profileForReturn: ElevationProfilePoint[] =
    smoothedElevations.length > 0 && smoothedElevations.length === profileSoFar.length
      ? profileSoFar.map((p, i) => ({ ...p, e: smoothedElevations[i]! }))
      : profileSoFar;
  const postSampleMs = Date.now() - postSampleStartMs;

  const elapsedSec = Math.floor((Date.now() - startTimeMs) / 1000);
  demLog(
    `Enrichment completed: ${totalPoints.toLocaleString()} points in ${formatHhMmSs(elapsedSec)} (findTiles=${findTilesMs}ms tileOpen=${tileOpenMs}ms ${resampleInfo} sampling=${samplingMs}ms smooth=${smoothMs}ms stats=${statsMs}ms reads=${readsThisTrack} fallbacks=${fallbackCount})`
  );

  const hint =
    accumulatedState.validCount === 0
      ? ("all_nodata" as const)
      : undefined;
  if (hint) {
    console.warn(
      "[DEM] All",
      totalPoints,
      "samples were nodata or out of extent. Check tile CRS and that track is inside tile bounds."
    );
  }

  return {
    stats,
    distanceM: safeDistanceM,
    elevations: [],
    profile: profileForReturn.length > 0 ? profileForReturn : undefined,
    elevationHint: hint,
    _timing: {
      resampleMs,
      resampleInputPoints,
      resampleOutputPoints,
      resampleSpacingM,
      resampleSkipped,
      smoothMs,
      statsMs,
      postSampleMs,
    },
  };
}

/**
 * Enrich using a preloaded tile index (single combined track from whole GPX).
 * Supports resume from checkpoint and chunked processing with bounded memory.
 */
export async function enrichGpxWithDemFromIndex(
  gpxText: string,
  index: DemTileIndex,
  options?: DemEnrichmentProgressCallback | EnrichFromIndexOptions
): Promise<ElevationEnrichmentResult> {
  const { points, bounds } = extractPointsAndBounds(gpxText);
  if (points.length === 0) return { ...EMPTY_RESULT };
  const opts = typeof options === "function" ? { onProgress: options } : options;
  return enrichSingleTrackFromIndex(points, bounds, index, opts);
}

/** Aggregate file-level stats from per-track enrichment. */
export type EnrichmentAggregates = {
  distanceM: number;
  minElevationM: number;
  maxElevationM: number;
  totalAscentM: number;
  totalDescentM: number;
  averageGradePct: number;
  averageSteepnessPct: number;
};

function computeAggregates(tracks: EnrichedTrackSummary[]): EnrichmentAggregates {
  if (tracks.length === 0) {
    return {
      distanceM: 0,
      minElevationM: 0,
      maxElevationM: 0,
      totalAscentM: 0,
      totalDescentM: 0,
      averageGradePct: 0,
      averageSteepnessPct: 0,
    };
  }
  let distanceM = 0;
  let totalAscentM = 0;
  let totalDescentM = 0;
  let minElevationM = Infinity;
  let maxElevationM = -Infinity;
  for (const t of tracks) {
    distanceM += t.distanceM;
    totalAscentM += t.totalAscentM;
    totalDescentM += t.totalDescentM;
    if (t.validCount > 0) {
      minElevationM = Math.min(minElevationM, t.minElevationM);
      maxElevationM = Math.max(maxElevationM, t.maxElevationM);
    }
  }
  const netElevationM = totalAscentM - totalDescentM;
  const totalClimbM = totalAscentM + totalDescentM;
  const rawGrade = distanceM > 0 ? (netElevationM / distanceM) * 100 : 0;
  const rawSteepness = distanceM > 0 ? (totalClimbM / distanceM) * 100 : 0;
  const averageGradePct = Number.isFinite(rawGrade) ? rawGrade : 0;
  const averageSteepnessPct = Number.isFinite(rawSteepness) ? rawSteepness : 0;
  return {
    distanceM,
    minElevationM: Number.isFinite(minElevationM) ? minElevationM : 0,
    maxElevationM: Number.isFinite(maxElevationM) ? maxElevationM : 0,
    totalAscentM,
    totalDescentM,
    averageGradePct,
    averageSteepnessPct,
  };
}

/** Merge one track into running aggregates (for incremental / memory-safe mode). */
function mergeTrackIntoAggregates(
  acc: EnrichmentAggregates,
  t: EnrichedTrackSummary
): EnrichmentAggregates {
  const distanceM = acc.distanceM + t.distanceM;
  const totalAscentM = acc.totalAscentM + t.totalAscentM;
  const totalDescentM = acc.totalDescentM + t.totalDescentM;
  let minElevationM = acc.minElevationM;
  let maxElevationM = acc.maxElevationM;
  if (t.validCount > 0) {
    minElevationM = Math.min(minElevationM, t.minElevationM);
    maxElevationM = Math.max(maxElevationM, t.maxElevationM);
  }
  const netElevationM = totalAscentM - totalDescentM;
  const totalClimbM = totalAscentM + totalDescentM;
  const rawGrade = distanceM > 0 ? (netElevationM / distanceM) * 100 : 0;
  const rawSteepness = distanceM > 0 ? (totalClimbM / distanceM) * 100 : 0;
  return {
    distanceM,
    minElevationM: Number.isFinite(minElevationM) ? minElevationM : 0,
    maxElevationM: Number.isFinite(maxElevationM) ? maxElevationM : 0,
    totalAscentM,
    totalDescentM,
    averageGradePct: Number.isFinite(rawGrade) ? rawGrade : 0,
    averageSteepnessPct: Number.isFinite(rawSteepness) ? rawSteepness : 0,
  };
}

const M_TO_FT = 3.28084;
const M_TO_MI = 1 / 1609.344;

/** Minimum segment length (m) to include; shorter segments are skipped to reduce GPS jitter. */
const CURVINESS_MIN_SEGMENT_M = 3;
/** Minimum turning angle (degrees) to count; smaller turns are ignored to reduce noise. */
const CURVINESS_MIN_ANGLE_DEG = 2;
/** Cap each turn's contribution (deg) so a single GPS spike doesn't dominate track average. */
const CURVINESS_MAX_TURN_DEG = 90;
const M_PER_MI = 1609.344;
const CURVINESS_SMOOTH_WINDOW = 5;

/**
 * Remove consecutive points with the same lat/lon so curviness sees a polyline with no zero-length
 * segments. Preserves elevation when present (keeps first of each duplicate run).
 */
function collapseConsecutiveDuplicatePoints(
  points: PointWithOptionalEle[]
): PointWithOptionalEle[] {
  if (points.length <= 1) return points;
  const out: PointWithOptionalEle[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (prev[0] !== curr[0] || prev[1] !== curr[1]) {
      out.push(curr);
    }
  }
  return out;
}

/**
 * Light moving-average smoothing of lat/lon for curviness only (map geometry unchanged).
 * Reduces GPS jitter before bearing/turn computation; window 5 preserves real bends.
 * Preserves endpoints by using only available points in the window.
 */
function smoothLatLonForCurviness(
  points: PointWithOptionalEle[],
  windowSize: number
): PointWithOptionalEle[] {
  const n = points.length;
  if (n < 3 || windowSize < 2) return points;
  const half = Math.floor(windowSize / 2);
  const result: PointWithOptionalEle[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    let sumLat = 0;
    let sumLon = 0;
    for (let j = start; j < end; j++) {
      sumLat += points[j]![0];
      sumLon += points[j]![1];
    }
    const lat = sumLat / (end - start);
    const lng = sumLon / (end - start);
    const ele = points[i]?.[2];
    result.push(ele !== undefined ? [lat, lng, ele] : [lat, lng]);
  }
  return result;
}

/**
 * Compute average curviness: cumulative absolute direction change per unit distance.
 * Caller should pass coordinates that are lightly smoothed to reduce GPS noise.
 * For each interior point B (with A = prev, C = next): bearing A→B and B→C (forward azimuth),
 * turning angle = smallest angle between bearings in [-180, 180], then |angle|.
 * Sum of |turning angles| is normalized by the same path's total length → degrees per mile.
 * Straight ≈ 0; winding = higher. Noise: segments < CURVINESS_MIN_SEGMENT_M and turns < CURVINESS_MIN_ANGLE_DEG are excluded.
 */
function computeCurvinessDegPerMile(
  points: PointWithOptionalEle[],
  distanceM: number
): number {
  if (points.length < 3) return 0;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const line = lineString(points.map((p) => [p[1], p[0]]));
  const pathLengthM = length(line, { units: "meters" });
  const safeDistanceM =
    Number.isFinite(pathLengthM) && pathLengthM > 0 ? pathLengthM : distanceM;
  const denomM = Number.isFinite(safeDistanceM) && safeDistanceM > 0 ? safeDistanceM : 0;
  if (denomM <= 0) return 0;

  function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    let θ = toDeg(Math.atan2(y, x));
    if (θ < 0) θ += 360;
    return θ;
  }

  function segmentLengthM(i: number): number {
    const [lat1, lon1] = points[i]!;
    const [lat2, lon2] = points[i + 1]!;
    const seg = lineString([
      [lon1, lat1],
      [lon2, lat2],
    ]);
    return length(seg, { units: "meters" });
  }

  let sumAbsTurnDeg = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const latA = a[0];
    const lonA = a[1];
    const latB = b[0];
    const lonB = b[1];
    const latC = c[0];
    const lonC = c[1];
    if (
      !Number.isFinite(latA) ||
      !Number.isFinite(lonA) ||
      !Number.isFinite(latB) ||
      !Number.isFinite(lonB) ||
      !Number.isFinite(latC) ||
      !Number.isFinite(lonC)
    )
      continue;
    const segAB = segmentLengthM(i - 1);
    const segBC = segmentLengthM(i);
    if (segAB < CURVINESS_MIN_SEGMENT_M || segBC < CURVINESS_MIN_SEGMENT_M) continue;
    const bearingAB = bearingDeg(latA, lonA, latB, lonB);
    const bearingBC = bearingDeg(latB, lonB, latC, lonC);
    let turnDeg = bearingBC - bearingAB;
    while (turnDeg > 180) turnDeg -= 360;
    while (turnDeg < -180) turnDeg += 360;
    const absTurn = Math.abs(turnDeg);
    if (absTurn < CURVINESS_MIN_ANGLE_DEG) continue;
    sumAbsTurnDeg += Math.min(absTurn, CURVINESS_MAX_TURN_DEG);
  }

  const degPerMeter = sumAbsTurnDeg / denomM;
  const degPerMile = degPerMeter * M_PER_MI;
  return Number.isFinite(degPerMile) ? Math.max(0, degPerMile) : 0;
}

/** Minimum segment length (m) for grade; shorter segments are skipped to avoid noise. */
const GRADE_MIN_SEGMENT_M = 1;

/**
 * Compute maximum grade (percent) from a smoothed elevation profile.
 * Uses same noise reduction as average grade: segments shorter than GRADE_MIN_SEGMENT_M
 * or with elevation change smaller than ELEVATION_CHANGE_THRESHOLD_M are ignored.
 * Returns the maximum segment grade by magnitude (uphill or downhill).
 */
function computeMaximumGradePct(profile: Array<{ d: number; e: number }>): number {
  if (!profile || profile.length < 2) return 0;
  let maxGradePct = 0;
  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1]!;
    const curr = profile[i]!;
    const distM = curr.d - prev.d;
    const elevM = curr.e - prev.e;
    const absElevM = Math.abs(elevM);
    if (
      !Number.isFinite(distM) ||
      !Number.isFinite(elevM) ||
      distM < GRADE_MIN_SEGMENT_M ||
      absElevM < ELEVATION_CHANGE_THRESHOLD_M
    )
      continue;
    const gradePct = Math.abs((elevM / distM) * 100);
    if (Number.isFinite(gradePct) && gradePct > maxGradePct) maxGradePct = gradePct;
  }
  return maxGradePct;
}

function toEnrichedTrackSummary(
  track: import("./gpx-extract").ExtractedTrack,
  result: ElevationEnrichmentResult
): EnrichedTrackSummary {
  const { bounds } = track;
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLng = (bounds.west + bounds.east) / 2;
  const profileForStorage =
    result.profile && result.profile.length > 0
      ? result.profile.map((p) => ({
          d: Number((p.d * M_TO_MI).toFixed(6)),
          e: Number((p.e * M_TO_FT).toFixed(2)),
          lat: p.lat,
          lng: p.lng,
        }))
      : null;
  const distinctPoints = collapseConsecutiveDuplicatePoints(track.points);
  const pointsForCurviness = smoothLatLonForCurviness(
    distinctPoints,
    CURVINESS_SMOOTH_WINDOW
  );
  const averageCurvinessDegPerMile = computeCurvinessDegPerMile(
    pointsForCurviness,
    result.distanceM
  );

  const maximumGradePct =
    result.profile && result.profile.length >= 2
      ? computeMaximumGradePct(
          result.profile.map((p) => ({ d: p.d, e: p.e }))
        )
      : 0;

  return {
    trackIndex: track.trackIndex,
    name: track.name,
    pointCount: result.stats.totalCount,
    bounds: track.bounds,
    centerLat,
    centerLng,
    distanceM: result.distanceM,
    minElevationM: result.stats.minElevationM,
    maxElevationM: result.stats.maxElevationM,
    totalAscentM: result.stats.totalAscentM,
    totalDescentM: result.stats.totalDescentM,
    averageGradePct: result.stats.averageGradePct,
    averageSteepnessPct: result.stats.averageSteepnessPct,
    maximumGradePct,
    averageCurvinessDegPerMile,
    validCount: result.stats.validCount,
    elevationProfileJson: profileForStorage ? JSON.stringify(profileForStorage) : null,
  };
}

export type PerTrackEnrichmentResult = {
  enrichedTracks: EnrichedTrackSummary[];
  aggregates: EnrichmentAggregates;
  /** Set when onTrackComplete was used (no array retained). */
  trackCount?: number;
  totalPoints?: number;
  hasAnyValidData?: boolean;
};

/**
 * Enrich each track in the GPX separately and return per-track results plus file-level aggregates.
 * Progress reports overall points processed across all tracks.
 * When demBasePath is omitted or empty, uses only GPX elevation (no DEM); tracks with lat/lon/ele enrich successfully.
 */
export async function enrichGpxWithDemPerTrack(
  gpxText: string,
  config: DemEnrichmentConfig
): Promise<PerTrackEnrichmentResult> {
  const tracks = extractTracks(gpxText);
  if (tracks.length === 0) {
    return {
      enrichedTracks: [],
      aggregates: computeAggregates([]),
    };
  }

  const useGpxOnly = !config.demBasePath?.trim();
  if (useGpxOnly) {
    const gpxEleCount = tracks.flatMap((t) => t.points).filter(hasGpxElevation).length;
    const totalPts = tracks.reduce((s, t) => s + t.points.length, 0);
    try {
      process.stderr.write(
        `[DEM] GPX-only enrichment: ${gpxEleCount}/${totalPts} points have elevation from GPX; no DEM.\n`
      );
    } catch {
      console.warn("[DEM] GPX-only enrichment:", gpxEleCount, "/", totalPts, "points have GPX elevation; no DEM.");
    }
    let totalPoints = 0;
    for (const t of tracks) totalPoints += t.points.length;
    if (config.onProgress) {
      config.onProgress({ processedPoints: 0, totalPoints, percentComplete: 0 });
    }
    let completedPoints = 0;
    const enrichedTracks: EnrichedTrackSummary[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const c = config.isCancelled?.();
      const cancelled = await Promise.resolve(c);
      if (cancelled) throw new Error("ENRICHMENT_CANCELLED");
      const track = tracks[i]!;
      const result = enrichSingleTrackGpxOnly(track.points, track.bounds);
      enrichedTracks.push(toEnrichedTrackSummary(track, result));
      completedPoints += track.points.length;
      if (config.onProgress) {
        const pct = totalPoints > 0 ? Math.min(100, Math.round((completedPoints / totalPoints) * 100)) : 0;
        config.onProgress({ processedPoints: completedPoints, totalPoints, percentComplete: pct });
      }
    }
    return { enrichedTracks, aggregates: computeAggregates(enrichedTracks) };
  }

  const index = await loadTileIndex({
    demBasePath: config.demBasePath!,
    manifestPath: config.manifestPath,
  });

  // Total points in resampled space (same denominator as processedPoints) for accurate progress.
  let totalPoints = 0;
  for (const t of tracks) {
    const line = lineString(t.points.map((p) => [p[1], p[0]]));
    const distanceM = length(line, { units: "meters" });
    const safeDistanceM = Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : 0;
    const n =
      safeDistanceM > 0 && t.points.length > 1
        ? Math.ceil(safeDistanceM / RESAMPLE_SPACING_M) + 1
        : t.points.length;
    totalPoints += n;
  }

  if (config.onProgress) {
    config.onProgress({ processedPoints: 0, totalPoints, percentComplete: 0 });
  }

  let completedPoints = 0;
  let totalResampleMs = 0;
  let totalPostSampleMs = 0;
  const useStreaming = Boolean(config.onTrackComplete);
  const enrichedTracks: EnrichedTrackSummary[] = useStreaming ? [] : [];
  let runningAggregates: {
    distanceM: number;
    minElevationM: number;
    maxElevationM: number;
    totalAscentM: number;
    totalDescentM: number;
    averageGradePct: number;
    averageSteepnessPct: number;
  } = {
    distanceM: 0,
    minElevationM: Infinity,
    maxElevationM: -Infinity,
    totalAscentM: 0,
    totalDescentM: 0,
    averageGradePct: 0,
    averageSteepnessPct: 0,
  };
  let trackCount = 0;
  let totalPointsOut = 0;
  let hasAnyValidData = false;
  const sharedSampler = new DemRasterSampler(index.basePath);

  const demLog = (msg: string): void => {
    try {
      process.stderr.write(`[DEM] ${msg}\n`);
    } catch {
      console.warn("[DEM]", msg);
    }
  };

  // Preload all tiles that intersect the full GPX bbox so no track pays first-touch open cost.
  let unionWest = Infinity;
  let unionSouth = Infinity;
  let unionEast = -Infinity;
  let unionNorth = -Infinity;
  for (const t of tracks) {
    if (t.bounds.west < unionWest) unionWest = t.bounds.west;
    if (t.bounds.south < unionSouth) unionSouth = t.bounds.south;
    if (t.bounds.east > unionEast) unionEast = t.bounds.east;
    if (t.bounds.north > unionNorth) unionNorth = t.bounds.north;
  }
  const unionBbox: Wgs84Bbox =
    unionWest <= unionEast && unionSouth <= unionNorth
      ? [unionWest, unionSouth, unionEast, unionNorth]
      : [0, 0, 0, 0];
  const preloadTiles = findIntersectingTiles(index.tiles, unionBbox);
  const preloadStartMs = Date.now();
  const preloadedOpenTiles: OpenTileT[] = [];
  for (const meta of preloadTiles) {
    const open = await sharedSampler.openTile(meta);
    if (open != null) preloadedOpenTiles.push(open);
  }
  const preloadMs = Date.now() - preloadStartMs;
  if (preloadTiles.length > 0) {
    demLog(
      `Preloaded ${preloadedOpenTiles.length}/${preloadTiles.length} DEM tiles for job bbox in ${preloadMs}ms`
    );
  }

  try {
    for (let i = 0; i < tracks.length; i++) {
      const c = config.isCancelled?.();
      const cancelled = await Promise.resolve(c);
      if (cancelled) {
        throw new Error("ENRICHMENT_CANCELLED");
      }
      const track = tracks[i]!;
      const progressOffset = completedPoints;
      const onProgress =
        config.onProgress &&
        ((data: { processedPoints: number; totalPoints: number; percentComplete: number }) => {
          const globalProcessed = progressOffset + data.processedPoints;
          const pct =
            totalPoints > 0
              ? Math.min(100, Math.round((globalProcessed / totalPoints) * 100))
              : 0;
          config.onProgress!({
            processedPoints: globalProcessed,
            totalPoints,
            percentComplete: pct,
          });
        });

      demLog(`Enriching track ${i + 1}/${tracks.length}: ${track.name}`);
      const result = await enrichSingleTrackFromIndex(track.points, track.bounds, index, {
        onProgress,
        sharedSampler,
        preloadedOpenTiles: preloadedOpenTiles.length > 0 ? preloadedOpenTiles : undefined,
        isCancelled: config.isCancelled,
      });
      if (result._timing) {
        totalResampleMs += result._timing.resampleMs;
        totalPostSampleMs += result._timing.postSampleMs;
      }
      const summary = toEnrichedTrackSummary(track, result);
      if (useStreaming) {
        runningAggregates = mergeTrackIntoAggregates(runningAggregates, summary);
        trackCount += 1;
        totalPointsOut += result.stats.totalCount;
        if (summary.validCount > 0) hasAnyValidData = true;
        config.onTrackComplete!(summary);
      } else {
        enrichedTracks.push(summary);
      }
      completedPoints += result.stats.totalCount;
    }
  } finally {
    const stats = sharedSampler.getStats();
    demLog(
      `Job DEM stats: tileOpen hits=${stats.openTileHits} misses=${stats.openTileMisses} ` +
        `readRasterCalls=${stats.readRasterCalls} oversizedSplits=${stats.oversizedBatchSplits} subBatchReads=${stats.subBatchReads} ` +
        `totalResampleMs=${totalResampleMs} totalPostSampleMs=${totalPostSampleMs}`
    );
    sharedSampler.closeAll();
  }

  if (useStreaming) {
    const agg: EnrichmentAggregates = {
      ...runningAggregates,
      minElevationM: Number.isFinite(runningAggregates.minElevationM) ? runningAggregates.minElevationM : 0,
      maxElevationM: Number.isFinite(runningAggregates.maxElevationM) ? runningAggregates.maxElevationM : 0,
    };
    return {
      enrichedTracks: [],
      aggregates: agg,
      trackCount,
      totalPoints: totalPointsOut,
      hasAnyValidData,
    };
  }
  const aggregates = computeAggregates(enrichedTracks);
  return { enrichedTracks, aggregates };
}
