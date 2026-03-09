import type { ElevationStats } from "./types";

/** Elevation value that is valid for stats (finite number). Null = nodata / missing. */
export type ElevationValue = number | null;

/** Moving average window size for elevation smoothing. Odd number recommended (e.g. 5, 7, 9). */
export const ELEVATION_SMOOTH_WINDOW_SIZE = 7;

/** Minimum elevation change (m) to count toward ascent/descent. Changes smaller than this are ignored to reduce noise. ~0.3 m ≈ 1 ft. */
export const ELEVATION_CHANGE_THRESHOLD_M = 0.3048;

/**
 * Smooth an elevation series with a centered moving average.
 * Uses a partial window at the ends. Window should be odd; if even, behaves as windowSize - 1.
 */
export function smoothElevationSeries(
  elevations: ReadonlyArray<number>,
  windowSize: number
): number[] {
  const n = elevations.length;
  if (n === 0 || windowSize < 1) return [...elevations];
  const half = Math.floor(Math.max(1, windowSize) / 2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      const v = elevations[j];
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    out.push(count > 0 ? sum / count : elevations[i] ?? 0);
  }
  return out;
}

/**
 * Collect finite values in [start, end), optionally excluding 0 when the window has any non-zero
 * (so nodata zeros don't pull the curve down).
 */
function windowValues(
  elevations: ReadonlyArray<number>,
  start: number,
  end: number,
  excludeZeroWhenOtherPresent: boolean
): number[] {
  const values: number[] = [];
  let hasNonZero = false;
  for (let j = start; j < end; j++) {
    const v = elevations[j];
    if (typeof v === "number" && Number.isFinite(v)) {
      values.push(v);
      if (v !== 0) hasNonZero = true;
    }
  }
  if (excludeZeroWhenOtherPresent && hasNonZero) {
    return values.filter((v) => v !== 0);
  }
  return values;
}

/**
 * Smooth an elevation series with a centered median filter.
 * Reduces single-point spikes/dips better than a moving average while preserving real terrain steps.
 * Uses a partial window at the ends. Zeros are excluded from the window when any other value in the
 * window is non-zero (so nodata zeros stored as 0 do not pull the profile down).
 */
export function smoothElevationSeriesMedian(
  elevations: ReadonlyArray<number>,
  windowSize: number
): number[] {
  const n = elevations.length;
  if (n === 0 || windowSize < 1) return [...elevations];
  const half = Math.floor(Math.max(1, windowSize) / 2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    const values = windowValues(elevations, start, end, true);
    if (values.length === 0) {
      out.push(elevations[i] ?? 0);
      continue;
    }
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
    out.push(median);
  }
  return out;
}

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

export type ComputeElevationStatsOptions = {
  /** Ignore segment elevation changes smaller than this (m) for ascent/descent. Reduces noise. */
  ascentDescentThresholdM?: number;
};

/**
 * Compute elevation statistics from a sequence of elevations (meters).
 * Nodata (null) and non-finite values are skipped for min/max and ascent/descent.
 * Optional ascentDescentThresholdM: segment changes smaller than this are not counted toward ascent/descent.
 */
export function computeElevationStats(
  elevations: ReadonlyArray<ElevationValue>,
  options?: ComputeElevationStatsOptions
): ElevationStats {
  const thresholdM = options?.ascentDescentThresholdM ?? 0;
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
    if (!Number.isFinite(d)) continue;
    const absD = Math.abs(d);
    if (absD < thresholdM) continue;
    if (d > 0) totalAscentM += d;
    else totalDescentM += -d;
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
 * Optional options.ascentDescentThresholdM: segment changes below this are not counted toward ascent/descent.
 */
export function computeElevationStatsWithDistance(
  elevations: ReadonlyArray<ElevationValue>,
  horizontalDistanceM: number,
  options?: ComputeElevationStatsOptions
): ElevationStats {
  const stats = computeElevationStats(elevations, options);
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
  let chunkMin = Infinity;
  let chunkMax = -Infinity;
  let validCountChunk = 0;
  let totalAscentM = prev.totalAscentM;
  let totalDescentM = prev.totalDescentM;
  let prior = prev.priorElevationM;
  for (let i = 0; i < chunkElevations.length; i++) {
    const curr = chunkElevations[i];
    if (curr == null || typeof curr !== "number" || !Number.isFinite(curr)) continue;
    validCountChunk++;
    if (curr < chunkMin) chunkMin = curr;
    if (curr > chunkMax) chunkMax = curr;
    if (prior != null && Number.isFinite(prior)) {
      const d = curr - prior;
      if (Number.isFinite(d)) {
        if (d > 0) totalAscentM += d;
        else totalDescentM += -d;
      }
    }
    prior = curr;
  }
  let min = prev.minElevationM;
  let max = prev.maxElevationM;
  if (validCountChunk > 0) {
    if (prev.validCount === 0) {
      min = chunkMin;
      max = chunkMax;
    } else {
      min = Math.min(prev.minElevationM, chunkMin);
      max = Math.max(prev.maxElevationM, chunkMax);
    }
  }
  return {
    minElevationM: min,
    maxElevationM: max,
    totalAscentM,
    totalDescentM,
    validCount: prev.validCount + validCountChunk,
    priorElevationM: prior,
  };
}
