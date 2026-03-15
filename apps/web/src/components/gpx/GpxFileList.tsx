"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { GpxFileRecordForDisplay } from "@/lib/gpx";

const PHASE_LABELS: Record<string, string> = {
  setup: "Preparing…",
  parsing: "Parsing GPX",
  enrichment: "Elevation sampling",
  saving: "Saving results",
  completed: "Complete",
};

function formatHhMmSs(totalMs: number): string {
  const totalSeconds = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type ProgressSnapshot = {
  status: string;
  overallPercentComplete?: number;
  currentPhase?: string;
  processedPoints?: number;
  totalPoints?: number;
  elapsedMs?: number | null;
  estimatedRemainingMs?: number | null;
  currentTrackIndex?: number;
  totalTracks?: number;
  error?: string;
};

const POLL_INTERVAL_MS = 1000;

function EnrichmentProgressIcon({ jobId }: { jobId: string }) {
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/gpx/enrichment-progress?jobId=${encodeURIComponent(jobId)}`, { credentials: "include" });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as ProgressSnapshot;
          if (!cancelled) setProgress(data);
        }
      } finally {
        inFlight = false;
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [jobId]);

  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!tooltipVisible || typeof document === "undefined") return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    setTooltipStyle({
      position: "fixed" as const,
      left: rect.left + rect.width / 2,
      top: rect.top,
      transform: "translate(-50%, -100%) translateY(-4px)",
      zIndex: 9999,
    });
  }, [tooltipVisible]);

  const phaseLabel = progress?.currentPhase ? (PHASE_LABELS[progress.currentPhase] ?? progress.currentPhase) : "Enrichment";
  const pct = progress?.overallPercentComplete ?? 0;
  const processed = progress?.processedPoints ?? 0;
  const total = progress?.totalPoints ?? 0;
  const curTrack = progress?.currentTrackIndex;
  const totalTracks = progress?.totalTracks;

  const lines: string[] = [];
  if (progress?.status === "failed" && progress?.error) {
    lines.push("Enrichment failed", progress.error);
  } else if (progress?.status === "cancelled") {
    lines.push("Enrichment cancelled");
  } else {
    lines.push("Enrichment in progress");
    lines.push(`Phase: ${phaseLabel}`);
    lines.push(`Overall progress: ${Math.round(pct)}%`);
    if (totalTracks != null && totalTracks > 0 && curTrack != null) {
      lines.push(`Track: ${curTrack + 1} / ${totalTracks}`);
    }
    if (total > 0) {
      lines.push(`Points: ${processed.toLocaleString()} / ${total.toLocaleString()}`);
    }
  }

  const elapsedMs = progress?.elapsedMs;
  const estimatedRemainingMs = progress?.estimatedRemainingMs;
  const elapsedStr =
    elapsedMs != null && Number.isFinite(elapsedMs) ? formatHhMmSs(elapsedMs) : null;
  const remainingStr =
    estimatedRemainingMs != null && Number.isFinite(estimatedRemainingMs)
      ? formatHhMmSs(estimatedRemainingMs)
      : null;
  const showTimeRows = elapsedStr != null || remainingStr != null;

  const tooltipContent = tooltipVisible ? (
    <span
      ref={tooltipRef}
      className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-left text-xs font-normal text-slate-200 shadow-lg"
      style={{ maxWidth: "260px", width: "max-content", ...tooltipStyle }}
      role="tooltip"
    >
      <span className="block whitespace-pre-line">{lines.join("\n")}</span>
      {showTimeRows && (
        <span className="mt-1 block font-mono text-slate-300">
          {elapsedStr != null && (
            <span className="block">
              <span className="inline-block w-[5.5rem] text-slate-400">Elapsed:</span>{" "}
              {elapsedStr}
            </span>
          )}
          {remainingStr != null && (
            <span className="block">
              <span className="inline-block w-[5.5rem] text-slate-400">Remaining:</span>{" "}
              {remainingStr}
            </span>
          )}
        </span>
      )}
    </span>
  ) : null;

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      role="status"
      aria-label="Enrichment in progress"
    >
      <span className="inline-flex h-3 w-3 items-center justify-center text-sky-400" aria-hidden>
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      {typeof document !== "undefined" && tooltipContent
        ? createPortal(tooltipContent, document.body)
        : null}
    </span>
  );
}

type GpxFileListProps = {
  files: GpxFileRecordForDisplay[];
  orderedFileIds: string[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onReorder: (newOrderedIds: string[]) => void;
  /** File ID -> enrichment job ID for files currently being enriched. Shows working icon + tooltip. */
  activeEnrichmentJobByFileId?: Record<string, string>;
};

const filesById = (files: GpxFileRecordForDisplay[]) =>
  Object.fromEntries(files.map((f) => [f.id, f]));

/** insertBeforeId: id to insert before, or null to append to end. */
function reorderIds(ids: string[], draggedId: string, insertBeforeId: string | null): string[] {
  const next = ids.filter((id) => id !== draggedId);
  if (insertBeforeId === null) {
    next.push(draggedId);
    return next;
  }
  if (draggedId === insertBeforeId) return ids;
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
  activeEnrichmentJobByFileId = {},
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
  const ordered = order.map((id) => byId[id]).filter(Boolean) as GpxFileRecordForDisplay[];

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

  function getInsertBeforeId(
    e: React.DragEvent,
    overId: string,
    orderedList: GpxFileRecordForDisplay[]
  ): string | null {
    const index = orderedList.findIndex((f) => f.id === overId);
    if (index === -1) return overId;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const bottomHalf = e.clientY >= rect.top + rect.height / 2;
    if (bottomHalf && index < orderedList.length - 1) return orderedList[index + 1]!.id;
    if (bottomHalf && index === orderedList.length - 1) return null;
    return overId;
  }

  function handleDragOver(e: React.DragEvent, overId: string) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const id = draggedId ?? e.dataTransfer.getData("text/plain");
    if (!id) return;
    const current = previewOrder ?? orderedFileIds;
    const insertBeforeId = getInsertBeforeId(e, overId, ordered);
    if (insertBeforeId === overId && id === overId) return;
    const next = reorderIds(current, id, insertBeforeId);
    if (next.join() !== current.join()) applyPreview(next);
  }

  function handleDrop(e: React.DragEvent, dropTargetId: string) {
    e.preventDefault();
    e.stopPropagation();
    // Use state fallback: getData() can be empty on drop in some browsers (e.g. Safari)
    const id = (e.dataTransfer.getData("text/plain") || draggedId) ?? "";
    if (!id) return;
    const current = latestPreviewRef.current ?? previewOrder ?? orderedFileIds;
    const insertBeforeId = getInsertBeforeId(e, dropTargetId, ordered);
    if (insertBeforeId === dropTargetId && id === dropTargetId) return;
    const next = reorderIds(current, id, insertBeforeId);
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
          <span className="flex shrink-0 items-center gap-0.5">
            {activeEnrichmentJobByFileId[f.id] ? (
              <EnrichmentProgressIcon jobId={activeEnrichmentJobByFileId[f.id]!} />
            ) : null}
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: f.color || "#3b82f6" }}
              title={f.color}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
