/**
 * Unit conversion for user-facing display.
 * Internal calculations (DEM, Turf, geodesic) stay in meters; convert to feet
 * only when storing results for the UI or returning data to the client.
 */
const M_TO_FT = 3.28084;

export function metersToFeet(m: number): number {
  return Number.isFinite(m) ? m * M_TO_FT : 0;
}

export function metersArrayToFeet(values: number[]): number[] {
  return values.map((v) => (Number.isFinite(v) ? v * M_TO_FT : 0));
}
