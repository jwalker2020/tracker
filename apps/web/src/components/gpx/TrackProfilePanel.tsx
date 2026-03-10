"use client";

import { useMemo } from "react";
import type { ProfilePoint } from "./TrackElevationProfile";
import { TrackElevationProfile } from "./TrackElevationProfile";
import { TrackCurvinessProfile } from "./TrackCurvinessProfile";
import { TrackGradeProfile } from "./TrackGradeProfile";
import { computeCurvinessProfile, computeGradeProfile, smoothGradeProfile } from "./track-profile-utils";

export type TrackProfilePanelProps = {
  trackName: string;
  profilePoints: ProfilePoint[] | null;
  trackPoints: [number, number][] | null;
  /** Shared hover index; both charts and map use this. */
  hoveredIndex: number | null;
  /** Called when user hovers either chart. */
  onHoverIndex: (index: number | null) => void;
};

/**
 * Stacks elevation and curviness profile charts and keeps hover in sync.
 * Both charts use the same hoveredIndex and shared distance range so they stay aligned.
 */
export function TrackProfilePanel({
  trackName,
  profilePoints,
  trackPoints,
  hoveredIndex,
  onHoverIndex,
}: TrackProfilePanelProps) {
  const curvinessData = useMemo(
    () => computeCurvinessProfile(profilePoints, trackPoints),
    [profilePoints, trackPoints]
  );
  const gradeData = useMemo(() => {
    const raw = computeGradeProfile(profilePoints);
    if (!raw) return null;
    const absolute = raw.map((p) => ({ d: p.d, g: Math.abs(p.g) }));
    return smoothGradeProfile(absolute);
  }, [profilePoints]);

  const distanceRange = useMemo(() => {
    if (!profilePoints || profilePoints.length < 2) return null;
    const dVals = profilePoints.map((p) => p.d).filter((d) => Number.isFinite(d));
    if (dVals.length < 2) return null;
    return { minD: Math.min(...dVals), maxD: Math.max(...dVals) };
  }, [profilePoints]);

  return (
    <div className="flex h-full flex-col gap-1.5 min-h-0">
      <div className="min-h-0 flex-1 flex flex-col">
        <TrackElevationProfile
          trackName={trackName}
          profilePoints={profilePoints}
          trackPoints={trackPoints}
          distanceRange={distanceRange}
          hoveredIndex={hoveredIndex}
          onHoverIndex={onHoverIndex}
        />
      </div>
      <div className="min-h-0 flex-1 flex flex-col">
        <TrackCurvinessProfile
          trackName={trackName}
          profilePoints={profilePoints}
          curvinessData={curvinessData}
          trackPoints={trackPoints}
          distanceRange={distanceRange}
          hoveredIndex={hoveredIndex}
          onHoverIndex={onHoverIndex}
        />
      </div>
      <div className="min-h-0 flex-1 flex flex-col">
        <TrackGradeProfile
          trackName={trackName}
          profilePoints={profilePoints}
          gradeData={gradeData}
          trackPoints={trackPoints}
          distanceRange={distanceRange}
          hoveredIndex={hoveredIndex}
          onHoverIndex={onHoverIndex}
        />
      </div>
    </div>
  );
}
