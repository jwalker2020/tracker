"use client";

import { RangeFilter } from "@/components/ui/range-filter";

export type TrackFilterState = {
  gradeMin: number;
  gradeMax: number;
  curvinessMin: number;
  curvinessMax: number;
};

export type TrackFiltersProps = {
  /** Current filter bounds (controlled). */
  filterState: TrackFilterState;
  /** Called with a partial state; merged with current so min/max updates from one slider don't overwrite the other. */
  onFilterChange: (patch: Partial<TrackFilterState>) => void;
  /** Data bounds for sliders (from loaded tracks). */
  gradeBounds: { dataMin: number; dataMax: number };
  curvinessBounds: { dataMin: number; dataMax: number };
  totalTracks: number;
  visibleCount: number;
  /** Reset to full range (show all). */
  onReset: () => void;
};

export function TrackFilters({
  filterState,
  onFilterChange,
  gradeBounds,
  curvinessBounds,
  totalTracks,
  visibleCount,
  onReset,
}: TrackFiltersProps) {
  return (
    <section aria-label="Track filters">
      <h2 className="mb-3 text-sm font-semibold text-slate-100">Track filters</h2>
      <div className="space-y-4">
        <RangeFilter
          label="Average grade"
          dataMin={0}
          dataMax={100}
          valueMin={Math.max(0, Math.min(100, filterState.gradeMin))}
          valueMax={Math.max(0, Math.min(100, filterState.gradeMax))}
          onMinChange={(v) => onFilterChange({ gradeMin: v })}
          onMaxChange={(v) => onFilterChange({ gradeMax: v })}
          step={0.5}
          unit="%"
        />
        <RangeFilter
          label="Curviness"
          dataMin={curvinessBounds.dataMin}
          dataMax={curvinessBounds.dataMax}
          valueMin={filterState.curvinessMin}
          valueMax={filterState.curvinessMax}
          onMinChange={(v) => onFilterChange({ curvinessMin: v })}
          onMaxChange={(v) => onFilterChange({ curvinessMax: v })}
          step={1}
          unit=" °/mi"
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
