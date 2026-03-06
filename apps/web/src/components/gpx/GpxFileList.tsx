"use client";

import type { GpxFileRecord } from "@/lib/gpx-files";

type GpxFileListProps = {
  files: GpxFileRecord[];
  orderedFileIds: string[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onReorder: (newOrderedIds: string[]) => void;
};

const filesById = (files: GpxFileRecord[]) =>
  Object.fromEntries(files.map((f) => [f.id, f]));

export function GpxFileList({
  files,
  orderedFileIds,
  selectedIds,
  onToggle,
  onReorder,
}: GpxFileListProps) {
  const byId = filesById(files);
  const ordered = orderedFileIds.map((id) => byId[id]).filter(Boolean) as GpxFileRecord[];

  if (ordered.length === 0) {
    return (
      <p className="text-sm text-slate-400">No GPX files yet. Upload one above.</p>
    );
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.setData("application/x-gpx-id", id);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, dropTargetId: string) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === dropTargetId) return;
    const idx = orderedFileIds.indexOf(draggedId);
    const dropIdx = orderedFileIds.indexOf(dropTargetId);
    if (idx === -1 || dropIdx === -1) return;
    const next = [...orderedFileIds];
    next.splice(idx, 1);
    next.splice(next.indexOf(dropTargetId), 0, draggedId);
    onReorder(next);
  }

  return (
    <ul className="space-y-1">
      {ordered.map((f) => (
        <li
          key={f.id}
          data-id={f.id}
          className="flex items-center gap-2 rounded border border-transparent py-0.5"
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, f.id)}
        >
          <span
            draggable
            onDragStart={(e) => handleDragStart(e, f.id)}
            className="cursor-grab touch-none select-none text-slate-500 hover:text-slate-300"
            title="Drag to reorder"
            aria-label="Drag to reorder"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="block">
              <circle cx="4" cy="4" r="1" />
              <circle cx="8" cy="4" r="1" />
              <circle cx="4" cy="8" r="1" />
              <circle cx="8" cy="8" r="1" />
            </svg>
          </span>
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
