"use client";

import { RangeFilter } from "@/components/ui/range-filter";
import { InfoTooltip } from "@/components/ui/info-tooltip";

export type TrackFilterState = {
  gradeMin: number;
  gradeMax: number;
  maximumGradeMin: number;
  maximumGradeMax: number;
  curvinessMin: number;
  curvinessMax: number;
  averageElevationMin: number;
  averageElevationMax: number;
  maximumElevationMin: number;
  maximumElevationMax: number;
};

export type TrackFiltersProps = {
  /** Current filter bounds (controlled). */
  filterState: TrackFilterState;
  /** Called with a partial state; merged with current so min/max updates from one slider don't overwrite the other. */
  onFilterChange: (patch: Partial<TrackFilterState>) => void;
  /** Slider extents = selected-data min/max (from selected GPX files). */
  gradeBounds: { dataMin: number; dataMax: number };
  maximumGradeBounds: { dataMin: number; dataMax: number };
  curvinessBounds: { dataMin: number; dataMax: number };
  averageElevationBounds: { dataMin: number; dataMax: number };
  maximumElevationBounds: { dataMin: number; dataMax: number };
  totalTracks: number;
  visibleCount: number;
  /** Reset to full range (show all). */
  onReset: () => void;
};

export function TrackFilters({
  filterState,
  onFilterChange,
  gradeBounds,
  maximumGradeBounds,
  curvinessBounds,
  averageElevationBounds,
  maximumElevationBounds,
  totalTracks,
  visibleCount,
  onReset,
}: TrackFiltersProps) {
  const avgElevMin = Math.max(
    averageElevationBounds.dataMin,
    Math.min(averageElevationBounds.dataMax, filterState.averageElevationMin)
  );
  const avgElevMax = Math.max(
    averageElevationBounds.dataMin,
    Math.min(averageElevationBounds.dataMax, filterState.averageElevationMax)
  );
  const maxElevMin = Math.max(
    maximumElevationBounds.dataMin,
    Math.min(maximumElevationBounds.dataMax, filterState.maximumElevationMin)
  );
  const maxElevMax = Math.max(
    maximumElevationBounds.dataMin,
    Math.min(maximumElevationBounds.dataMax, filterState.maximumElevationMax)
  );
  return (
    <section aria-label="Track filters" className="shrink-0">
      <div className="mb-3 flex items-center gap-0">
        <h2 className="text-sm font-semibold text-slate-100">Track filters</h2>
        <InfoTooltip
          alignLeft
          text="You can drag the sliders to filter tracks. 'Average grade' is the average steepness for the entire track. 'Maximum grade' is the steepest part. 'Curviness' is how twisty the track is. 'Average elevation' and 'Maximum elevation' filter by the mean and peak elevation of the track (tracks with no elevation data are hidden when an elevation filter is active)."
        />
      </div>
      <div className="space-y-4">
        <RangeFilter
          label="Average grade"
          dataMin={gradeBounds.dataMin}
          dataMax={gradeBounds.dataMax}
          valueMin={Math.max(gradeBounds.dataMin, Math.min(gradeBounds.dataMax, filterState.gradeMin))}
          valueMax={Math.max(gradeBounds.dataMin, Math.min(gradeBounds.dataMax, filterState.gradeMax))}
          onMinChange={(v) => onFilterChange({ gradeMin: v })}
          onMaxChange={(v) => onFilterChange({ gradeMax: v })}
          step={0.5}
          unit="%"
          valueDecimals={1}
        />
        <RangeFilter
          label="Maximum grade"
          dataMin={maximumGradeBounds.dataMin}
          dataMax={maximumGradeBounds.dataMax}
          valueMin={Math.max(maximumGradeBounds.dataMin, Math.min(maximumGradeBounds.dataMax, filterState.maximumGradeMin))}
          valueMax={Math.max(maximumGradeBounds.dataMin, Math.min(maximumGradeBounds.dataMax, filterState.maximumGradeMax))}
          onMinChange={(v) => onFilterChange({ maximumGradeMin: v })}
          onMaxChange={(v) => onFilterChange({ maximumGradeMax: v })}
          step={0.5}
          unit="%"
          valueDecimals={1}
        />
        <RangeFilter
          label="Curviness"
          dataMin={curvinessBounds.dataMin}
          dataMax={curvinessBounds.dataMax}
          valueMin={Math.max(curvinessBounds.dataMin, Math.min(curvinessBounds.dataMax, filterState.curvinessMin))}
          valueMax={Math.max(curvinessBounds.dataMin, Math.min(curvinessBounds.dataMax, filterState.curvinessMax))}
          onMinChange={(v) => onFilterChange({ curvinessMin: v })}
          onMaxChange={(v) => onFilterChange({ curvinessMax: v })}
          step={1}
          unit=" °/mi"
        />
        <RangeFilter
          label="Average elevation"
          dataMin={averageElevationBounds.dataMin}
          dataMax={averageElevationBounds.dataMax}
          valueMin={avgElevMin}
          valueMax={avgElevMax}
          onMinChange={(v) => onFilterChange({ averageElevationMin: v })}
          onMaxChange={(v) => onFilterChange({ averageElevationMax: v })}
          step={50}
          unit=" ft"
          valueDecimals={0}
        />
        <RangeFilter
          label="Maximum elevation"
          dataMin={maximumElevationBounds.dataMin}
          dataMax={maximumElevationBounds.dataMax}
          valueMin={maxElevMin}
          valueMax={maxElevMax}
          onMinChange={(v) => onFilterChange({ maximumElevationMin: v })}
          onMaxChange={(v) => onFilterChange({ maximumElevationMax: v })}
          step={50}
          unit=" ft"
          valueDecimals={0}
        />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600"
          >
            Reset filters
          </button>
          <span className="text-xs text-slate-400">
            Showing {visibleCount} of {totalTracks} tracks
          </span>
        </div>
      </div>
    </section>
  );
}
