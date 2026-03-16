/**
 * Unit conversion for user-facing display.
 * Internal calculations (DEM, Turf, geodesic) stay in meters; convert to feet
 * only when storing results for the UI or returning data to the client.
 */
const M_TO_FT = 3.28084;
const FT_PER_MILE = 5280;

export function metersToFeet(m: number): number {
  return Number.isFinite(m) ? m * M_TO_FT : 0;
}

export function metersArrayToFeet(values: number[]): number[] {
  return values.map((v) => (Number.isFinite(v) ? v * M_TO_FT : 0));
}

export function feetToMiles(ft: number): number {
  return Number.isFinite(ft) && ft >= 0 ? ft / FT_PER_MILE : 0;
}

/** Format distance for UI: "12.4 miles" (1 decimal). */
export function formatDistanceMiles(distanceFt: number): string {
  const miles = feetToMiles(distanceFt);
  return `${miles.toFixed(1)} miles`;
}

/** Format elevation for UI: "3,250 ft" (whole number, localized). Never shows below 0. */
export function formatElevationFt(ft: number): string {
  const n = Number.isFinite(ft) ? Math.max(0, Math.round(ft)) : 0;
  return `${n.toLocaleString()} ft`;
}
