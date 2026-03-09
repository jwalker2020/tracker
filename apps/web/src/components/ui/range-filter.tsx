"use client";

import { useCallback, useRef, useState } from "react";

/** Tolerance for "props caught up" so we stop showing committed ref and use valueMin/valueMax. */
const PROP_MATCH_TOLERANCE = 1e-6;

const DEBUG = typeof process !== "undefined" && process.env.NODE_ENV === "development";

export type RangeFilterProps = {
  label: string;
  dataMin: number;
  dataMax: number;
  valueMin: number;
  valueMax: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
  step?: number;
  unit?: string;
};

function roundToStep(value: number, step: number, min: number): number {
  const n = Math.round((value - min) / step) * step + min;
  return Math.round(n * 100) / 100;
}

/**
 * Dual-handle range on a single track. Two handles; range between them is selected.
 * Dragging one handle past the other moves both. Commits on pointer release.
 * During drag, position is stored only in a ref and a tick forces re-render so state cannot reset the handle.
 */
export function RangeFilter({
  label,
  dataMin,
  dataMax,
  valueMin,
  valueMax,
  onMinChange,
  onMaxChange,
  step = 0.1,
  unit = "",
}: RangeFilterProps) {
  const [dragging, setDragging] = useState<"min" | "max" | null>(null);
  const [, setTick] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"min" | "max" | null>(null);
  const dragMinRef = useRef(valueMin);
  const dragMaxRef = useRef(valueMax);
  const captureTargetRef = useRef<HTMLElement | null>(null);
  /** True after we commit in onUp; clear when parent props match so we avoid showing stale valueMin/valueMax. */
  const justCommittedRef = useRef(false);

  const mountIdRef = useRef<string | null>(null);
  if (mountIdRef.current === null) {
    mountIdRef.current = Math.random().toString(36).slice(2, 9);
    if (DEBUG) console.log("[RF MOUNT]", label, mountIdRef.current);
  }
  const prevValueMinRef = useRef(valueMin);
  const prevValueMaxRef = useRef(valueMax);
  const prevDraggingRef = useRef<"min" | "max" | null>(null);

  const range = Math.max(dataMax - dataMin, step);
  const safeDataMin = Number.isFinite(dataMin) ? dataMin : 0;
  const safeDataMax = Number.isFinite(dataMax) ? dataMax : safeDataMin + range;

  const valueToPct = useCallback(
    (v: number) => (range > 0 ? ((v - safeDataMin) / range) * 100 : 0),
    [range, safeDataMin]
  );

  const showCommitted =
    justCommittedRef.current &&
    Math.abs(valueMin - dragMinRef.current) <= PROP_MATCH_TOLERANCE &&
    Math.abs(valueMax - dragMaxRef.current) <= PROP_MATCH_TOLERANCE;
  if (showCommitted) justCommittedRef.current = false;

  const displayMin =
    dragging !== null ? dragMinRef.current : justCommittedRef.current ? dragMinRef.current : valueMin;
  const displayMax =
    dragging !== null ? dragMaxRef.current : justCommittedRef.current ? dragMaxRef.current : valueMax;

  if (DEBUG) {
    if (prevValueMinRef.current !== valueMin) {
      console.log("[RF PROP valueMin]", label, prevValueMinRef.current, "->", valueMin);
    }
    if (prevValueMaxRef.current !== valueMax) {
      console.log("[RF PROP valueMax]", label, prevValueMaxRef.current, "->", valueMax);
    }
    if (prevDraggingRef.current !== dragging) {
      console.log("[RF STATE dragging]", label, String(prevDraggingRef.current), "->", String(dragging));
    }
    prevValueMinRef.current = valueMin;
    prevValueMaxRef.current = valueMax;
    prevDraggingRef.current = dragging;
  }

  const minPct = valueToPct(displayMin);
  const maxPct = valueToPct(displayMax);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, which: "min" | "max") => {
      e.preventDefault();
      dragMinRef.current = valueMin;
      dragMaxRef.current = valueMax;
      draggingRef.current = which;
      setDragging(which);
      const target = e.currentTarget as HTMLElement;
      captureTargetRef.current = target;
      target.setPointerCapture(e.pointerId);
      const track = trackRef.current;
      if (!track) return;

      const onMove = (ev: Event) => {
        const e = ev as PointerEvent;
        e.preventDefault();
        if (draggingRef.current === null || !trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pct = Math.max(
          0,
          Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)
        );
        const v = roundToStep(
          safeDataMin + (pct / 100) * range,
          step,
          safeDataMin
        );
        if (draggingRef.current === "min") {
          dragMinRef.current = v;
          if (v >= dragMaxRef.current) dragMaxRef.current = v;
        } else {
          dragMaxRef.current = v;
          if (v <= dragMinRef.current) dragMinRef.current = v;
        }
        setTick((t) => t + 1);
      };

      const onUp = (ev: Event) => {
        const e = ev as PointerEvent;
        if (draggingRef.current === null) return;
        if (DEBUG) console.log("[RF onUp]", label, mountIdRef.current, e.type);
        const el = captureTargetRef.current;
        if (el) {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerup", onUp);
          el.removeEventListener("pointercancel", onUp);
          el.releasePointerCapture(e.pointerId);
          captureTargetRef.current = null;
        }
        const minV = Math.max(
          safeDataMin,
          Math.min(dragMinRef.current, safeDataMax)
        );
        const maxV = Math.max(
          safeDataMin,
          Math.min(dragMaxRef.current, safeDataMax)
        );
        const finalMin = Math.min(minV, maxV);
        const finalMax = Math.max(minV, maxV);
        dragMinRef.current = finalMin;
        dragMaxRef.current = finalMax;
        justCommittedRef.current = true;
        onMinChange(finalMin);
        onMaxChange(finalMax);
        draggingRef.current = null;
        setDragging(null);
      };

      target.addEventListener("pointermove", onMove, { passive: false });
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [valueMin, valueMax, safeDataMin, safeDataMax, range, step, onMinChange, onMaxChange]
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>{label}</span>
        <span>
          {Number(displayMin).toFixed(2)}{unit} – {Number(displayMax).toFixed(2)}{unit}
        </span>
      </div>
      <div
        ref={trackRef}
        className="relative h-8 w-full touch-none"
        {...(DEBUG && { "data-range-filter": label })}
      >
        <div className="absolute left-0 right-0 top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-slate-600" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-sky-500/50"
          style={{
            left: `${minPct}%`,
            width: `${maxPct - minPct}%`,
          }}
        />
        <button
          type="button"
          role="slider"
          aria-label={`${label} minimum`}
          aria-valuemin={safeDataMin}
          aria-valuemax={safeDataMax}
          aria-valuenow={displayMin}
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 shadow cursor-grab active:cursor-grabbing touch-none focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-900"
          style={{ left: `${minPct}%` }}
          onPointerDown={(e) => handlePointerDown(e, "min")}
        />
        <button
          type="button"
          role="slider"
          aria-label={`${label} maximum`}
          aria-valuemin={safeDataMin}
          aria-valuemax={safeDataMax}
          aria-valuenow={displayMax}
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 shadow cursor-grab active:cursor-grabbing touch-none focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-900"
          style={{ left: `${maxPct}%` }}
          onPointerDown={(e) => handlePointerDown(e, "max")}
        />
      </div>
    </div>
  );
}
