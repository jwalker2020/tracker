"use client";

/**
 * Placeholder for map legend (e.g. track names and colors).
 * To be wired to selected/visible tracks later.
 */
export function GpxLegend() {
  return (
    <section aria-label="Map legend">
      <h2 className="mb-2 text-sm font-semibold text-slate-100">Legend</h2>
      <p className="text-xs text-slate-400">Select files to see tracks on the map.</p>
    </section>
  );
}
