"use client";

import length from "@turf/length";
import { lineString } from "@turf/helpers";
import type { ProfilePoint } from "./TrackElevationProfile";
import { getLatLngForIndex } from "./TrackElevationProfile";

const M_PER_MI = 1609.344;
const MIN_SEGMENT_M = 2;
const MIN_ANGLE_DEG = 2;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
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

/**
 * Compute per-point curviness (deg/mi) from profile points and track geometry.
 * Uses same index space as elevation profile; each point gets a curviness value (0 at ends).
 */
export function computeCurvinessProfile(
  profilePoints: ProfilePoint[] | null,
  trackPoints: [number, number][] | null | undefined
): { d: number; c: number }[] | null {
  if (!profilePoints || profilePoints.length < 3) return null;
  const n = profilePoints.length;
  const points: { lat: number; lng: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ll = getLatLngForIndex(profilePoints, trackPoints, i);
    const p = profilePoints[i];
    if (!ll || !p || !Number.isFinite(p.d)) return null;
    points.push({ lat: ll[0], lng: ll[1], d: p.d });
  }
  const result: { d: number; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = profilePoints[i]!.d;
    if (i === 0 || i === n - 1) {
      result.push({ d, c: 0 });
      continue;
    }
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const bearingAB = bearingDeg(a.lat, a.lng, b.lat, b.lng);
    const bearingBC = bearingDeg(b.lat, b.lng, c.lat, c.lng);
    let turnDeg = bearingBC - bearingAB;
    while (turnDeg > 180) turnDeg -= 360;
    while (turnDeg < -180) turnDeg += 360;
    const absTurn = Math.abs(turnDeg);
    let segLenM = 0;
    try {
      const seg1 = lineString([
        [a.lng, a.lat],
        [b.lng, b.lat],
      ]);
      const seg2 = lineString([
        [b.lng, b.lat],
        [c.lng, c.lat],
      ]);
      segLenM = (length(seg1, { units: "meters" }) + length(seg2, { units: "meters" })) / 2;
    } catch {
      segLenM = 0;
    }
    if (segLenM < MIN_SEGMENT_M || absTurn < MIN_ANGLE_DEG) {
      result.push({ d, c: 0 });
    } else {
      const degPerMeter = absTurn / segLenM;
      const degPerMile = degPerMeter * M_PER_MI;
      result.push({ d, c: Number.isFinite(degPerMile) ? Math.max(0, degPerMile) : 0 });
    }
  }
  return result;
}
