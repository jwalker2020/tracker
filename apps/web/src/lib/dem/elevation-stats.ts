import type { ElevationStats } from "./types";

/**
 * Compute elevation statistics from a sequence of elevations (meters).
 * Null/NaN values are skipped for min/max; ascent/descent use only consecutive valid pairs.
 */
export function computeElevationStats(
  elevations: ReadonlyArray<number | null>
): ElevationStats {
  const valid = elevations.filter(
    (e): e is number => e != null && !Number.isNaN(e)
  );
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
  let totalAscentM = 0;
  let totalDescentM = 0;

  for (const e of valid) {
    if (e < min) min = e;
    if (e > max) max = e;
  }

  for (let i = 1; i < elevations.length; i++) {
    const prev = elevations[i - 1];
    const curr = elevations[i];
    if (prev == null || curr == null || Number.isNaN(prev) || Number.isNaN(curr))
      continue;
    const d = curr - prev;
    if (d > 0) totalAscentM += d;
    else totalDescentM += -d;
  }

  const horizontalDistanceM = 0; // Caller can pass in if they have it
  const averageGradePct =
    horizontalDistanceM > 0
      ? (totalAscentM / horizontalDistanceM) * 100
      : 0;

  return {
    minElevationM: min,
    maxElevationM: max,
    totalAscentM,
    totalDescentM,
    averageGradePct,
    validCount,
    totalCount,
  };
}

/**
 * Compute elevation stats and average grade using horizontal distance (meters).
 * Use this when you have distance (e.g. from Turf length) for correct grade.
 */
export function computeElevationStatsWithDistance(
  elevations: ReadonlyArray<number | null>,
  horizontalDistanceM: number
): ElevationStats {
  const stats = computeElevationStats(elevations);
  const averageGradePct =
    horizontalDistanceM > 0
      ? (stats.totalAscentM / horizontalDistanceM) * 100
      : 0;
  return { ...stats, averageGradePct };
}
