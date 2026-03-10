"use client";

import { useMemo } from "react";
import type { ProfilePoint } from "./TrackElevationProfile";
import { TrackElevationProfile } from "./TrackElevationProfile";
import { TrackCurvinessProfile } from "./TrackCurvinessProfile";
import { TrackGradeProfile } from "./TrackGradeProfile";
import { computeCurvinessProfile, computeGradeProfile } from "./track-profile-utils";

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
  const gradeData = useMemo(
    () => computeGradeProfile(profilePoints),
    [profilePoints]
  );

  const distanceRange = useMemo(() => {
    if (!profilePoints || profilePoints.length < 2) return null;
    const dVals = profilePoints.map((p) => p.d).filter((d) => Number.isFinite(d));
    if (dVals.length < 2) return null;
    return { minD: Math.min(...dVals), maxD: Math.max(...dVals) };
  }, [profilePoints]);

  return (
    <div className="flex min-h-[420px] flex-col gap-2">
      <div className="min-h-0 flex-1 flex flex-col min-h-[140px]">
        <TrackElevationProfile
          trackName={trackName}
          profilePoints={profilePoints}
          trackPoints={trackPoints}
          distanceRange={distanceRange}
          hoveredIndex={hoveredIndex}
          onHoverIndex={onHoverIndex}
        />
      </div>
      <div className="shrink-0">
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
      <div className="shrink-0">
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
