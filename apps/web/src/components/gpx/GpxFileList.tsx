"use client";

import type { GpxFileRecord } from "@/lib/gpx-files";

type GpxFileListProps = {
  files: GpxFileRecord[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
};

export function GpxFileList({ files, selectedIds, onToggle }: GpxFileListProps) {
  if (files.length === 0) {
    return (
      <p className="text-sm text-slate-400">No GPX files yet. Upload one above.</p>
    );
  }

  return (
    <ul className="space-y-1">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2">
          <input
            id={`gpx-${f.id}`}
            type="checkbox"
            checked={selectedIds.has(f.id)}
            onChange={() => onToggle(f.id)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-600 focus:ring-sky-500"
          />
          <label
            htmlFor={`gpx-${f.id}`}
            className="flex-1 cursor-pointer truncate text-sm text-slate-200"
          >
            {f.name}
          </label>
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: f.color || "#3b82f6" }}
            title={f.color}
          />
        </li>
      ))}
    </ul>
  );
}
