import type { ElevationStats } from "./types";

/** Elevation value that is valid for stats (finite number). Null = nodata / missing. */
export type ElevationValue = number | null;

/** Safe division: returns 0 when divisor is not positive finite. */
function safeDivide(num: number, denom: number): number {
  if (typeof num !== "number" || typeof denom !== "number") return 0;
  if (!Number.isFinite(num) || !Number.isFinite(denom)) return 0;
  if (denom <= 0) return 0;
  const q = num / denom;
  return Number.isFinite(q) ? q : 0;
}

/** True if value is valid elevation (finite number). Excludes null, NaN, ±Infinity. */
export function isValidElevation(e: ElevationValue): e is number {
  return e != null && typeof e === "number" && Number.isFinite(e);
}

/**
 * Compute elevation statistics from a sequence of elevations (meters).
 * Nodata (null) and non-finite values are skipped for min/max and ascent/descent.
 */
export function computeElevationStats(
  elevations: ReadonlyArray<ElevationValue>
): ElevationStats {
  const valid = elevations.filter(isValidElevation);
  const totalCount = elevations.length;
  const validCount = valid.length;

  if (validCount === 0) {
    return {
      minElevationM: 0,
      maxElevationM: 0,
      totalAscentM: 0,
      totalDescentM: 0,
      averageGradePct: 0,
      averageSteepnessPct: 0,
      validCount: 0,
      totalCount,
    };
  }

  let min = valid[0]!;
  let max = valid[0]!;
  for (const e of valid) {
    if (e < min) min = e;
    if (e > max) max = e;
  }

  let totalAscentM = 0;
  let totalDescentM = 0;
  for (let i = 1; i < elevations.length; i++) {
    const prev = elevations[i - 1];
    const curr = elevations[i];
    if (!isValidElevation(prev) || !isValidElevation(curr)) continue;
    const d = curr - prev;
    if (Number.isFinite(d)) {
      if (d > 0) totalAscentM += d;
      else totalDescentM += -d;
    }
  }

  return {
    minElevationM: min,
    maxElevationM: max,
    totalAscentM,
    totalDescentM,
    averageGradePct: 0,
    averageSteepnessPct: 0,
    validCount,
    totalCount,
  };
}

/**
 * Compute elevation stats and grade metrics using horizontal distance (meters).
 * Segments with missing (null) elevation are skipped for ascent/descent; denominator is total horizontal distance.
 * - averageGradePct: signed grade = (totalAscent - totalDescent) / distance × 100 (negative for net descent).
 * - averageSteepnessPct: absolute grade = (totalAscent + totalDescent) / distance × 100 (terrain steepness).
 * Returns 0 for grade/steepness when distance is zero or result is non-finite.
 */
export function computeElevationStatsWithDistance(
  elevations: ReadonlyArray<ElevationValue>,
  horizontalDistanceM: number
): ElevationStats {
  const stats = computeElevationStats(elevations);
  const safeDistance = Number.isFinite(horizontalDistanceM) && horizontalDistanceM > 0
    ? horizontalDistanceM
    : 0;
  const netElevationM = stats.totalAscentM - stats.totalDescentM;
  const totalClimbM = stats.totalAscentM + stats.totalDescentM;
  const rawGrade = safeDistance > 0 ? (netElevationM / safeDistance) * 100 : 0;
  const rawSteepness = safeDistance > 0 ? (totalClimbM / safeDistance) * 100 : 0;
  const averageGradePct = Number.isFinite(rawGrade) ? rawGrade : 0;
  const averageSteepnessPct = Number.isFinite(rawSteepness) ? rawSteepness : 0;
  return { ...stats, averageGradePct, averageSteepnessPct };
}

/** Accumulated state for incremental (chunked) stats. Used for resume/checkpoint. */
export type AccumulatedElevationState = {
  minElevationM: number;
  maxElevationM: number;
  totalAscentM: number;
  totalDescentM: number;
  validCount: number;
  /** Last valid elevation in the previous chunk (for ascent/descent continuity). */
  priorElevationM: number | null;
};

/**
 * Merge a chunk of elevations into accumulated state.
 * Preserves ascent/descent correctness across chunk boundaries using priorElevationM.
 * Returns updated state; priorElevationM in result is the last valid elevation in the chunk.
 */
export function mergeChunkElevationState(
  prev: AccumulatedElevationState,
  chunkElevations: ReadonlyArray<ElevationValue>
): AccumulatedElevationState {
  if (chunkElevations.length === 0) {
    return { ...prev };
  }
  const validInChunk = chunkElevations.filter(isValidElevation);
  let min = prev.minElevationM;
  let max = prev.maxElevationM;
  if (validInChunk.length > 0) {
    const chunkMin = Math.min(...validInChunk);
    const chunkMax = Math.max(...validInChunk);
    if (prev.validCount === 0) {
      min = chunkMin;
      max = chunkMax;
    } else {
      min = Math.min(prev.minElevationM, chunkMin);
      max = Math.max(prev.maxElevationM, chunkMax);
    }
  }
  let totalAscentM = prev.totalAscentM;
  let totalDescentM = prev.totalDescentM;
  let prior = prev.priorElevationM;
  for (let i = 0; i < chunkElevations.length; i++) {
    const curr = chunkElevations[i];
    if (!isValidElevation(curr)) continue;
    if (prior != null && Number.isFinite(prior)) {
      const d = curr - prior;
      if (Number.isFinite(d)) {
        if (d > 0) totalAscentM += d;
        else totalDescentM += -d;
      }
    }
    prior = curr;
  }
  return {
    minElevationM: min,
    maxElevationM: max,
    totalAscentM,
    totalDescentM,
    validCount: prev.validCount + validInChunk.length,
    priorElevationM: prior,
  };
}
