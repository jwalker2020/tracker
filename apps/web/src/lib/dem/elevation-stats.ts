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
    validCount,
    totalCount,
  };
}

/**
 * Compute elevation stats and average grade using horizontal distance (meters).
 * Grade = (totalAscentM / horizontalDistanceM) * 100 when distance > 0; else 0.
 */
export function computeElevationStatsWithDistance(
  elevations: ReadonlyArray<ElevationValue>,
  horizontalDistanceM: number
): ElevationStats {
  const stats = computeElevationStats(elevations);
  const safeDistance = Number.isFinite(horizontalDistanceM) && horizontalDistanceM > 0
    ? horizontalDistanceM
    : 0;
  const averageGradePct = safeDivide(stats.totalAscentM, safeDistance) * 100;
  return { ...stats, averageGradePct };
}
