"use client";

import type { GpxFileRecordForDisplay } from "@/lib/gpx";

type GpxLegendProps = {
  selectedFiles: GpxFileRecordForDisplay[];
};

function formatFt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function GpxLegend({ selectedFiles }: GpxLegendProps) {
  return (
    <section aria-label="Map legend">
      <h2 className="mb-2 text-sm font-semibold text-slate-100">Legend</h2>
      {selectedFiles.length === 0 ? (
        <p className="text-xs text-slate-400">Select files to see tracks on the map.</p>
      ) : (
        <ul className="space-y-1.5">
          {selectedFiles.map((f) => (
            <li key={f.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-slate-600"
                  style={{ backgroundColor: f.color || "#3b82f6" }}
                  aria-hidden
                />
                <span className="truncate text-xs text-slate-200">{f.name}</span>
              </div>
              {(f.distanceFt != null || f.totalAscentFt != null) && (
                <p className="pl-5 text-xs text-slate-400">
                  {f.distanceFt != null && `Distance: ${formatFt(f.distanceFt)} ft`}
                  {f.distanceFt != null && f.totalAscentFt != null && " · "}
                  {f.totalAscentFt != null && `Ascent: ${formatFt(f.totalAscentFt)} ft`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
