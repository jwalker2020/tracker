"use client";

import length from "@turf/length";
import { lineString } from "@turf/helpers";
import type { ProfilePoint } from "./TrackElevationProfile";
import { getLatLngForIndex } from "./TrackElevationProfile";

const M_PER_MI = 1609.344;
/** Min segment length (m) for turn to count; very short segments are ignored to avoid GPS jitter. */
const MIN_SEGMENT_M = 3;
/** Min turning angle (deg) to count; tiny angle changes are ignored as noise. */
const MIN_ANGLE_DEG = 2;
/** Cap per-point curviness (deg/mi) to avoid GPS spike outliers; real sharp turns stay below this. */
const MAX_CURVINESS_DEG_PER_MI = 5000;

const SMOOTH_WINDOW = 5;

/**
 * Light moving-average smoothing of lat/lng series to reduce GPS position noise
 * before curviness. Preserves endpoints by using only available points in the window.
 */
function smoothLatLon(
  points: { lat: number; lng: number }[],
  windowSize: number
): { lat: number; lng: number }[] {
  const n = points.length;
  if (n < 3 || windowSize < 2) return points;
  const half = Math.floor(windowSize / 2);
  const result: { lat: number; lng: number }[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    let sumLat = 0;
    let sumLon = 0;
    for (let j = start; j < end; j++) {
      sumLat += points[j]!.lat;
      sumLon += points[j]!.lng;
    }
    result.push({
      lat: sumLat / (end - start),
      lng: sumLon / (end - start),
    });
  }
  return result;
}

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
 * Lat/lon are lightly smoothed (moving average, window 5) before bearings/turn angles
 * to reduce GPS jitter; map geometry is unchanged. Units: degrees per mile (0 = straight).
 * Uses same index space as elevation profile; each point gets a curviness value (0 at ends).
 */
export function computeCurvinessProfile(
  profilePoints: ProfilePoint[] | null,
  trackPoints: [number, number][] | null | undefined
): { d: number; c: number }[] | null {
  if (!profilePoints || profilePoints.length < 3) return null;
  const n = profilePoints.length;
  const rawPoints: { lat: number; lng: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ll = getLatLngForIndex(profilePoints, trackPoints, i);
    const p = profilePoints[i];
    if (!ll || !p || !Number.isFinite(p.d)) return null;
    rawPoints.push({ lat: ll[0], lng: ll[1], d: p.d });
  }
  const smoothed = smoothLatLon(rawPoints, SMOOTH_WINDOW);
  const result: { d: number; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = profilePoints[i]!.d;
    if (i === 0 || i === n - 1) {
      result.push({ d, c: 0 });
      continue;
    }
    const a = smoothed[i - 1]!;
    const b = smoothed[i]!;
    const c = smoothed[i + 1]!;
    const bearingAB = bearingDeg(a.lat, a.lng, b.lat, b.lng);
    const bearingBC = bearingDeg(b.lat, b.lng, c.lat, c.lng);
    let turnDeg = bearingBC - bearingAB;
    while (turnDeg > 180) turnDeg -= 360;
    while (turnDeg < -180) turnDeg += 360;
    const absTurn = Math.abs(turnDeg);
    let seg1M = 0;
    let seg2M = 0;
    try {
      const seg1 = lineString([
        [a.lng, a.lat],
        [b.lng, b.lat],
      ]);
      const seg2 = lineString([
        [b.lng, b.lat],
        [c.lng, c.lat],
      ]);
      seg1M = length(seg1, { units: "meters" });
      seg2M = length(seg2, { units: "meters" });
    } catch {
      seg1M = 0;
      seg2M = 0;
    }
    const segLenM = (seg1M + seg2M) / 2;
    const bothSegmentsLongEnough =
      seg1M >= MIN_SEGMENT_M && seg2M >= MIN_SEGMENT_M;
    if (!bothSegmentsLongEnough || absTurn < MIN_ANGLE_DEG) {
      result.push({ d, c: 0 });
    } else {
      const degPerMeter = absTurn / segLenM;
      const degPerMile = degPerMeter * M_PER_MI;
      const c = Number.isFinite(degPerMile)
        ? Math.min(MAX_CURVINESS_DEG_PER_MI, Math.max(0, degPerMile))
        : 0;
      result.push({ d, c });
    }
  }
  return result;
}

/** Feet per mile for grade: rise (ft) / run (mi) → grade% = rise / (run * FT_PER_MI) * 100 */
const FT_PER_MI = 5280;

/**
 * Compute per-point grade (percent) from elevation profile.
 * profilePoints use d in miles, e in feet. Segment grade = (e[i]-e[i-1]) / ((d[i]-d[i-1]) * 5280) * 100.
 * Same index space as profilePoints; first point gets 0.
 */
export function computeGradeProfile(
  profilePoints: ProfilePoint[] | null
): { d: number; g: number }[] | null {
  if (!profilePoints || profilePoints.length < 2) return null;
  const result: { d: number; g: number }[] = [{ d: profilePoints[0]!.d, g: 0 }];
  for (let i = 1; i < profilePoints.length; i++) {
    const prev = profilePoints[i - 1]!;
    const curr = profilePoints[i]!;
    const d = curr.d;
    const deltaD = curr.d - prev.d;
    const deltaE = curr.e - prev.e;
    if (!Number.isFinite(deltaD) || !Number.isFinite(deltaE) || deltaD <= 0) {
      result.push({ d, g: 0 });
      continue;
    }
    const runFt = deltaD * FT_PER_MI;
    const gradePct = runFt !== 0 ? (deltaE / runFt) * 100 : 0;
    result.push({
      d,
      g: Number.isFinite(gradePct) ? gradePct : 0,
    });
  }
  return result;
}
