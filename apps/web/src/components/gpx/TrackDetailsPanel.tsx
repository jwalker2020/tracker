"use client";

import {
  formatDistanceMiles,
  formatElevationFt,
} from "@/lib/units";
import type { EnrichedTrackSummaryForDisplay } from "@/lib/gpx";
import { InfoTooltip } from "@/components/ui/info-tooltip";

type TrackDetailsPanelProps = {
  trackName: string;
  track: EnrichedTrackSummaryForDisplay | null;
};

export function TrackDetailsPanel({ trackName, track }: TrackDetailsPanelProps) {
  const hasEnrichment =
    track &&
    (track.validCount > 0 ||
      track.distanceFt > 0 ||
      track.totalAscentFt > 0 ||
      track.totalDescentFt > 0);

  return (
    <div className="flex h-full min-w-0 flex-col rounded border border-slate-700 bg-slate-900/95 p-3">
      <h3 className="font-semibold text-slate-100 text-sm">{trackName}</h3>
      {hasEnrichment && track ? (
        <dl className="mt-2 flex flex-col gap-1.5 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Distance</dt>
            <dd className="text-slate-200 tabular-nums">{formatDistanceMiles(track.distanceFt)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Min Elevation</dt>
            <dd className="text-slate-200 tabular-nums">{formatElevationFt(track.minElevationFt)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-400">Max Elevation</dt>
            <dd className="text-slate-200 tabular-nums">{formatElevationFt(track.maxElevationFt)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="flex items-center gap-0 text-slate-400">
              Elevation Δ
              <InfoTooltip text="The total elevation change, up AND down, over the entire track." />
            </dt>
            <dd className="text-slate-200 tabular-nums">
              {formatElevationFt(Math.abs(track.totalAscentFt) + Math.abs(track.totalDescentFt))}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="flex items-center gap-0 text-slate-400">
              Avg Grade
              <InfoTooltip text="The average steepness over the track. This is measured as a percent grade." />
            </dt>
            <dd className="text-slate-200 tabular-nums">
              {typeof track.averageGradePct === "number" && Number.isFinite(track.averageGradePct)
                ? `${Math.abs(track.averageGradePct).toFixed(2)}%`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="flex items-center gap-0 text-slate-400">
              Avg Curviness
              <InfoTooltip text="The average twistiness of the track." />
            </dt>
            <dd className="text-slate-200 tabular-nums">
              {typeof track.averageCurvinessDegPerMile === "number" &&
              Number.isFinite(track.averageCurvinessDegPerMile)
                ? `${track.averageCurvinessDegPerMile.toFixed(1)} °/mi`
                : "—"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-slate-400 text-xs">Elevation data not available</p>
      )}
    </div>
  );
}
