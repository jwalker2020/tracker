"use client";

import type { GpxFileRecord } from "@/lib/gpx";

type GpxLegendProps = {
  selectedFiles: GpxFileRecord[];
};

export function GpxLegend({ selectedFiles }: GpxLegendProps) {
  return (
    <section aria-label="Map legend">
      <h2 className="mb-2 text-sm font-semibold text-slate-100">Legend</h2>
      {selectedFiles.length === 0 ? (
        <p className="text-xs text-slate-400">Select files to see tracks on the map.</p>
      ) : (
        <ul className="space-y-1.5">
          {selectedFiles.map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-slate-600"
                style={{ backgroundColor: f.color || "#3b82f6" }}
                aria-hidden
              />
              <span className="truncate text-xs text-slate-200">{f.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
