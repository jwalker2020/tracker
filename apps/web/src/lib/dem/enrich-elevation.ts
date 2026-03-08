import along from "@turf/along";
import length from "@turf/length";
import { lineString } from "@turf/helpers";
import type { DemTileIndex, ElevationStats } from "./types";
import { findIntersectingTiles, boundsToWgs84Bbox } from "./intersect";
import { loadTileIndex } from "./tile-index";
import { DemRasterSampler } from "./sampler";
import {
  computeElevationStatsWithDistance,
  isValidElevation,
  mergeChunkElevationState,
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
  /** Path to folder containing DEM tiles (and manifest). */
  demBasePath: string;
  /** Optional path to manifest (default manifest.json). */
  manifestPath?: string;
  /** Optional progress callback during sampling (processedPoints, totalPoints, percentComplete). */
  onProgress?: DemEnrichmentProgressCallback;
  /** Optional resume state from a saved checkpoint. */
  resumeState?: EnrichmentResumeState;
  /** Optional checkpoint callback; called after each chunk with payload to persist. */
  onCheckpoint?: (payload: EnrichmentCheckpointPayload) => void | Promise<void>;
};

/** Lightweight profile: cumulative distance (m), elevation (m), and map coords per point. */
export type ElevationProfilePoint = { d: number; e: number; lat: number; lng: number };

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
};

const YIELD_EVERY_N_POINTS = 200;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Resample line to points at fixed spacing (meters). Returns [lat, lng][].
 * If length is 0 or spacing is 0, returns the line's first and last point if distinct.
 * Optional onProgress(processed, estimatedTotal) is called periodically and yields to the event loop.
 */
async function resampleLineToFixedSpacing(
  lineFeature: ReturnType<typeof lineString>,
  totalLengthM: number,
  spacingM: number,
  onProgress?: (processed: number, estimatedTotal: number) => void | Promise<void>
): Promise<Array<[number, number]>> {
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

type EnrichFromIndexOptions = {
  onProgress?: DemEnrichmentProgressCallback;
  resumeState?: EnrichmentResumeState;
  onCheckpoint?: (payload: EnrichmentCheckpointPayload) => void | Promise<void>;
};

/**
 * Enrich a single track (points + bounds) with DEM. Used by both whole-GPX and per-track flows.
 * Supports resume and checkpoint when options are provided.
 */
export async function enrichSingleTrackFromIndex(
  points: Array<[number, number]>,
  bounds: { south: number; west: number; north: number; east: number },
  index: DemTileIndex,
  options?: EnrichFromIndexOptions
): Promise<ElevationEnrichmentResult> {
  const onProgress = options?.onProgress;
  const resumeState = options?.resumeState;
  const onCheckpoint = options?.onCheckpoint;

  if (points.length === 0) return { ...EMPTY_RESULT };

  const line = lineString(points.map(([lat, lng]) => [lng, lat]));
  const distanceM = length(line, { units: "meters" });
  const safeDistanceM = Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : 0;
  const bbox = boundsToWgs84Bbox(bounds);
  const tiles = findIntersectingTiles(index.tiles, bbox);

  if (tiles.length === 0) {
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

  const sampler = new DemRasterSampler(index.basePath);
  const openTiles: NonNullable<Awaited<ReturnType<DemRasterSampler["openTile"]>>>[] = [];
  for (const meta of tiles) {
    const open = await sampler.openTile(meta);
    if (open != null) openTiles.push(open);
  }

  if (openTiles.length === 0) {
    const pathMod = await import("node:path");
    const firstPath = tiles[0]?.path ?? "(no tile)";
    const resolvedFirst = pathMod.isAbsolute(firstPath)
      ? firstPath
      : pathMod.join(index.basePath, firstPath);
    console.warn(
      "[DEM] No tile files could be opened for",
      tiles.length,
      "intersecting tile(s). DEM_BASE_PATH=",
      index.basePath || "(empty!)",
      "| first tile path:",
      firstPath,
      "| resolved:",
      resolvedFirst
    );
    sampler.closeAll();
    const elevations: (number | null)[] = points.map(() => null);
    const stats = computeElevationStatsWithDistance(elevations, safeDistanceM);
    return { stats, distanceM: safeDistanceM, elevations, elevationHint: "no_open_tiles" as const };
  }

  const estimatedTotal = Math.max(
    1,
    safeDistanceM > 0 && points.length > 1
      ? Math.ceil(safeDistanceM / RESAMPLE_SPACING_M) + 1
      : points.length
  );
  if (onProgress) {
    onProgress({ processedPoints: 0, totalPoints: estimatedTotal, percentComplete: 0 });
  }

  const pointsToSample =
    safeDistanceM > 0 && points.length > 1
      ? await resampleLineToFixedSpacing(line, safeDistanceM, RESAMPLE_SPACING_M, (processed, total) => {
          if (onProgress) {
            const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
            onProgress({ processedPoints: processed, totalPoints: total, percentComplete: pct });
          }
        })
      : points;

  const totalPoints = pointsToSample.length;
  const segmentLength = safeDistanceM / Math.max(1, totalPoints - 1);

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

  try {
    for (let chunkStart = startIndex; chunkStart < totalPoints; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalPoints);
      const chunkElevations: (number | null)[] = [];

      for (let i = chunkStart; i < chunkEnd; i++) {
        const [lat, lng] = pointsToSample[i]!;
        let value: number | null = null;
        for (const open of openTiles) {
          const sample = await sampler.sample(open, lng, lat);
          if (sample.elevationM != null && isValidElevation(sample.elevationM)) {
            value = sample.elevationM;
            break;
          }
        }
        chunkElevations.push(value);

        const cumDist = Math.round((i * segmentLength) * 10) / 10;
        const e = value != null && isValidElevation(value) ? Math.round(value * 10) / 10 : 0;
        profileSoFar.push({ d: cumDist, e, lat, lng });

        const processed = i + 1;
        if (processed % progressInterval === 0 || processed === totalPoints) {
          reportProgress(processed);
        }
      }

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

  const elapsedSec = Math.floor((Date.now() - startTimeMs) / 1000);
  demLog(
    `Enrichment completed: ${totalPoints.toLocaleString()} points in ${formatHhMmSs(elapsedSec)}`
  );

  sampler.closeAll();

  // Signed average grade = (totalAscent - totalDescent) / horizontal distance × 100 (negative for net descent).
  // Average steepness = (totalAscent + totalDescent) / horizontal distance × 100 (all segments, always ≥ 0).
  // Zero distance or non-finite totals yield 0; segments with missing elevation are already excluded from ascent/descent.
  const netElevationM = accumulatedState.totalAscentM - accumulatedState.totalDescentM;
  const totalClimbM = accumulatedState.totalAscentM + accumulatedState.totalDescentM;
  const rawGrade = safeDistanceM > 0 ? (netElevationM / safeDistanceM) * 100 : 0;
  const rawSteepness = safeDistanceM > 0 ? (totalClimbM / safeDistanceM) * 100 : 0;
  const averageGradePct = Number.isFinite(rawGrade) ? rawGrade : 0;
  const averageSteepnessPct = Number.isFinite(rawSteepness) ? rawSteepness : 0;
  const stats: ElevationStats = {
    minElevationM: accumulatedState.minElevationM,
    maxElevationM: accumulatedState.maxElevationM,
    totalAscentM: accumulatedState.totalAscentM,
    totalDescentM: accumulatedState.totalDescentM,
    averageGradePct,
    averageSteepnessPct,
    validCount: accumulatedState.validCount,
    totalCount: totalPoints,
  };
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
    profile: profileSoFar.length > 0 ? profileSoFar : undefined,
    elevationHint: hint,
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

const M_TO_FT = 3.28084;
const M_TO_MI = 1 / 1609.344;

/** Minimum segment length (m) to include; shorter segments are skipped to reduce GPS jitter. */
const CURVINESS_MIN_SEGMENT_M = 2;
/** Minimum turning angle (degrees) to count; smaller turns are ignored to reduce noise. */
const CURVINESS_MIN_ANGLE_DEG = 2;
const M_PER_MI = 1609.344;

/**
 * Compute average curviness: cumulative absolute direction change per unit distance.
 * For each interior point B (with A = prev, C = next): bearing A→B and B→C (forward azimuth),
 * turning angle = smallest angle between bearings in [-180, 180], then |angle|.
 * Sum of |turning angles| is normalized by the same path's total length → degrees per mile.
 * Straight ≈ 0; winding = higher. Noise: segments < 2 m and turns < 2° are excluded.
 */
function computeCurvinessDegPerMile(
  points: Array<[number, number]>,
  distanceM: number
): number {
  if (points.length < 3) return 0;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const line = lineString(points.map(([lat, lng]) => [lng, lat]));
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
    const [latA, lonA] = a;
    const [latB, lonB] = b;
    const [latC, lonC] = c;
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
    sumAbsTurnDeg += absTurn;
  }

  const degPerMeter = sumAbsTurnDeg / denomM;
  const degPerMile = degPerMeter * M_PER_MI;
  return Number.isFinite(degPerMile) ? Math.max(0, degPerMile) : 0;
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
  const averageCurvinessDegPerMile = computeCurvinessDegPerMile(track.points, result.distanceM);

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
    averageCurvinessDegPerMile,
    validCount: result.stats.validCount,
    elevationProfileJson: profileForStorage ? JSON.stringify(profileForStorage) : null,
  };
}

export type PerTrackEnrichmentResult = {
  enrichedTracks: EnrichedTrackSummary[];
  aggregates: EnrichmentAggregates;
};

/**
 * Enrich each track in the GPX separately and return per-track results plus file-level aggregates.
 * Progress reports overall points processed across all tracks.
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

  const index = await loadTileIndex({
    demBasePath: config.demBasePath,
    manifestPath: config.manifestPath,
  });

  const totalPointsEstimate = tracks.reduce((s, t) => s + t.points.length, 0);
  let completedPoints = 0;
  const enrichedTracks: EnrichedTrackSummary[] = [];

  const demLog = (msg: string): void => {
    try {
      process.stderr.write(`[DEM] ${msg}\n`);
    } catch {
      console.warn("[DEM]", msg);
    }
  };

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    const progressOffset = completedPoints;
    const onProgress =
      config.onProgress &&
      ((data: { processedPoints: number; totalPoints: number; percentComplete: number }) => {
        const globalProcessed = progressOffset + data.processedPoints;
        const pct =
          totalPointsEstimate > 0
            ? Math.min(100, Math.round((globalProcessed / totalPointsEstimate) * 100))
            : 0;
        config.onProgress!({
          processedPoints: globalProcessed,
          totalPoints: totalPointsEstimate,
          percentComplete: pct,
        });
      });

    demLog(`Enriching track ${i + 1}/${tracks.length}: ${track.name}`);
    const result = await enrichSingleTrackFromIndex(track.points, track.bounds, index, {
      onProgress,
    });
    enrichedTracks.push(toEnrichedTrackSummary(track, result));
    completedPoints += result.stats.totalCount;
  }

  const aggregates = computeAggregates(enrichedTracks);
  return { enrichedTracks, aggregates };
}
