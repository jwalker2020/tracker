"use client";

import { useState, useCallback, useRef } from "react";
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

function reorderIds(ids: string[], draggedId: string, insertBeforeId: string): string[] {
  if (draggedId === insertBeforeId) return ids;
  const next = ids.filter((id) => id !== draggedId);
  const insertIdx = next.indexOf(insertBeforeId);
  if (insertIdx === -1) return ids;
  next.splice(insertIdx, 0, draggedId);
  return next;
}

export function GpxFileList({
  files,
  orderedFileIds,
  selectedIds,
  onToggle,
  onReorder,
}: GpxFileListProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const latestPreviewRef = useRef<string[] | null>(null);

  const applyPreview = useCallback((next: string[]) => {
    latestPreviewRef.current = next;
    setPreviewOrder(next);
  }, []);

  const byId = filesById(files);
  const order = previewOrder ?? orderedFileIds;
  const ordered = order.map((id) => byId[id]).filter(Boolean) as GpxFileRecord[];

  if (ordered.length === 0) {
    return (
      <p className="text-sm text-slate-400">No GPX files yet. Upload one above.</p>
    );
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setDraggedId(id);
    const initial = [...orderedFileIds];
    latestPreviewRef.current = initial;
    setPreviewOrder(initial);
  }

  function handleDragEnd() {
    const toCommit = latestPreviewRef.current;
    latestPreviewRef.current = null;
    setDraggedId(null);
    setPreviewOrder(null);
    if (toCommit && toCommit.join() !== orderedFileIds.join()) {
      onReorder(toCommit);
    }
  }

  function handleDragOver(e: React.DragEvent, overId: string) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    // dataTransfer.getData() is only available on drop in Chrome; use state
    const id = draggedId ?? e.dataTransfer.getData("text/plain");
    if (!id || id === overId) return;
    const current = previewOrder ?? orderedFileIds;
    const next = reorderIds(current, id, overId);
    if (next.join() !== current.join()) applyPreview(next);
  }

  function handleDrop(e: React.DragEvent, dropTargetId: string) {
    e.preventDefault();
    e.stopPropagation();
    // Use state fallback: getData() can be empty on drop in some browsers (e.g. Safari)
    const id = (e.dataTransfer.getData("text/plain") || draggedId) ?? "";
    if (!id || id === dropTargetId) {
      // Don't clear ref here so handleDragEnd can still commit the preview order
      return;
    }
    const current = latestPreviewRef.current ?? previewOrder ?? orderedFileIds;
    const next = reorderIds(current, id, dropTargetId);
    onReorder(next);
    latestPreviewRef.current = null;
    setDraggedId(null);
    setPreviewOrder(null);
  }

  return (
    <ul className="space-y-1">
      {ordered.map((f) => (
        <li
          key={f.id}
          data-id={f.id}
          className="flex items-center gap-2 rounded border border-transparent py-0.5 transition-[opacity,transform] duration-200 ease-out"
          style={{
            opacity: draggedId === f.id ? 0.6 : 1,
          }}
          onDragOver={(e) => handleDragOver(e, f.id)}
          onDrop={(e) => handleDrop(e, f.id)}
        >
          <span
            draggable
            onDragStart={(e) => handleDragStart(e, f.id)}
            onDragEnd={handleDragEnd}
            className="cursor-grab touch-none select-none text-slate-500 hover:text-slate-300 active:cursor-grabbing"
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
