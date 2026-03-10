"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { ProfilePoint } from "./TrackElevationProfile";

export type CurvinessPoint = { d: number; c: number };

type TrackCurvinessProfileProps = {
  trackName: string;
  /** Same length as elevation profile; used for distance axis and hover index. */
  profilePoints: ProfilePoint[] | null;
  /** Per-point curviness (deg/mi); same index space as profilePoints. */
  curvinessData: CurvinessPoint[] | null;
  /** Optional track geometry for map hover fallback. */
  trackPoints?: [number, number][] | null;
  /** Shared distance range so this chart aligns with the elevation chart. */
  distanceRange?: { minD: number; maxD: number } | null;
  /** Shared hover index (controlled); when set, show vertical line at this index. */
  hoveredIndex?: number | null;
  /** Called with profile index on chart hover, null on leave. */
  onHoverIndex?: (index: number | null) => void;
};

export function TrackCurvinessProfile({
  trackName,
  profilePoints,
  curvinessData,
  trackPoints,
  distanceRange = null,
  hoveredIndex = null,
  onHoverIndex,
}: TrackCurvinessProfileProps) {
  const canSyncHover = Boolean(
    onHoverIndex &&
      profilePoints &&
      profilePoints.length >= 2 &&
      curvinessData &&
      curvinessData.length >= 2
  );

  const chartRef = useRef<ReactECharts>(null);
  const profilePointsRef = useRef(profilePoints);
  const chartDataRef = useRef<[number, number][] | null>(null);
  const onHoverIndexRef = useRef(onHoverIndex);
  const lastEmittedIndexRef = useRef<number | null>(null);
  const pendingIndexRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const scheduleHoverFlushRef = useRef<() => void>(() => {});

  const chartData = useMemo(() => {
    if (!curvinessData || curvinessData.length < 2) return null;
    return curvinessData.map((p) => [p.d, p.c] as [number, number]);
  }, [curvinessData]);

  profilePointsRef.current = profilePoints;
  chartDataRef.current = chartData;
  onHoverIndexRef.current = onHoverIndex;

  const hoverMarkLine = useMemo(() => {
    if (hoveredIndex == null || !profilePoints?.length || hoveredIndex < 0 || hoveredIndex >= profilePoints.length)
      return undefined;
    const d = profilePoints[hoveredIndex]?.d;
    if (d == null || !Number.isFinite(d)) return undefined;
    const c =
      curvinessData && hoveredIndex >= 0 && hoveredIndex < curvinessData.length
        ? curvinessData[hoveredIndex]?.c
        : undefined;
    const labelText =
      c != null && Number.isFinite(c) ? `${Number(c).toFixed(1)} °/mi` : "";
    return {
      silent: true,
      symbol: "none",
      lineStyle: { color: "#94a3b8", type: "solid", width: 1 },
      label: {
        show: Boolean(labelText),
        formatter: labelText,
        position: "insideEndTop",
        color: "#e2e8f0",
        fontSize: 10,
      },
      data: [{ xAxis: d }],
    };
  }, [hoveredIndex, profilePoints, curvinessData]);

  const option: EChartsOption = useMemo(() => {
    if (!chartData || chartData.length < 2) return {};
    const minD =
      distanceRange != null ? distanceRange.minD : Math.min(...chartData.map((d) => d[0]));
    const maxD =
      distanceRange != null ? distanceRange.maxD : Math.max(...chartData.map((d) => d[0]));
    const minC = Math.min(...chartData.map((d) => d[1]));
    const maxC = Math.max(...chartData.map((d) => d[1]));
    const padC = (maxC - minC) * 0.05 || 1;
    return {
      backgroundColor: "transparent",
      grid: { left: 56, right: 8, top: 4, bottom: 0, containLabel: false },
      xAxis: {
        type: "value",
        min: minD,
        max: maxD,
        axisLine: { lineStyle: { color: "#475569" } },
        splitLine: { show: false },
        axisLabel: { show: false },
      },
      yAxis: {
        type: "value",
        name: "Curviness",
        nameLocation: "middle",
        nameGap: 40,
        nameTextStyle: { color: "#94a3b8", fontSize: 16 },
        min: Math.max(0, minC - padC),
        max: maxC + padC,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "rgba(71, 85, 105, 0.3)" } },
        axisLabel: { show: false },
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        borderColor: "#475569",
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: "#e2e8f0", fontSize: 12 },
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : null;
          if (!p || !p.data) return "";
          const [distMi, c] = p.data as [number, number];
          return `<strong>Distance</strong> ${Number(distMi).toFixed(2)} mi<br/><strong>Curviness</strong> ${Number(c).toFixed(1)} °/mi`;
        },
      },
      series: [
        {
          type: "line",
          data: chartData,
          showSymbol: false,
          triggerLineEvent: true,
          smooth: true,
          lineStyle: { color: "#a78bfa", width: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(167, 139, 250, 0.25)" },
                { offset: 1, color: "rgba(167, 139, 250, 0)" },
              ],
            },
          },
          ...(hoverMarkLine ? { markLine: hoverMarkLine } : {}),
        },
      ],
    };
  }, [chartData, hoverMarkLine, distanceRange]);

  const scheduleHoverFlush = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const pending = pendingIndexRef.current;
      const last = lastEmittedIndexRef.current;
      if (pending !== last) {
        lastEmittedIndexRef.current = pending;
        onHoverIndexRef.current?.(pending);
      }
    });
  }, []);
  scheduleHoverFlushRef.current = scheduleHoverFlush;

  const onEvents = useMemo(() => {
    if (!canSyncHover) return undefined;
    return {
      mousemove: (params: {
        dataIndex?: number;
        event?: { offsetX?: number; offsetY?: number; clientX?: number; clientY?: number };
      }) => {
        const profilePts = profilePointsRef.current;
        const data = chartDataRef.current;
        const len = profilePts?.length ?? 0;
        if (len < 2 || !data?.length) return;
        let i: number;
        if (params.dataIndex != null && params.dataIndex >= 0 && params.dataIndex < len) {
          i = params.dataIndex;
        } else {
          const instance = chartRef.current?.getEchartsInstance?.();
          const ev = params.event;
          let pixelX: number | undefined;
          let pixelY: number | undefined;
          if (ev != null) {
            if (typeof ev.offsetX === "number" && typeof ev.offsetY === "number") {
              pixelX = ev.offsetX;
              pixelY = ev.offsetY;
            } else if (
              instance?.getDom &&
              typeof (ev as MouseEvent).clientX === "number" &&
              typeof (ev as MouseEvent).clientY === "number"
            ) {
              const dom = instance.getDom();
              if (dom) {
                const rect = dom.getBoundingClientRect();
                pixelX = (ev as MouseEvent).clientX - rect.left;
                pixelY = (ev as MouseEvent).clientY - rect.top;
              }
            }
          }
          if (
            instance &&
            pixelX != null &&
            pixelY != null &&
            Number.isFinite(pixelX) &&
            Number.isFinite(pixelY) &&
            data.length > 0
          ) {
            const point = instance.convertFromPixel(
              { seriesIndex: 0 },
              [pixelX, pixelY]
            ) as [number, number] | null | undefined;
            if (point != null && Array.isArray(point)) {
              const xVal = Number(point[0]);
              if (Number.isFinite(xVal)) {
                let bestIdx = 0;
                let best = Math.abs(data[0]![0]! - xVal);
                for (let j = 1; j < data.length; j++) {
                  const d = Math.abs(data[j]![0]! - xVal);
                  if (d < best) {
                    best = d;
                    bestIdx = j;
                  }
                }
                i = bestIdx;
              } else {
                i = -1;
              }
            } else {
              i = -1;
            }
          } else {
            i = -1;
          }
        }
        if (i < 0) {
          if (rafIdRef.current != null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          pendingIndexRef.current = null;
          if (lastEmittedIndexRef.current !== null) {
            lastEmittedIndexRef.current = null;
            onHoverIndexRef.current?.(null);
          }
          return;
        }
        i = Math.max(0, Math.min(i, len - 1));
        if (pendingIndexRef.current === i) return;
        pendingIndexRef.current = i;
        scheduleHoverFlushRef.current?.();
      },
      globalout: () => {
        if (rafIdRef.current != null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        pendingIndexRef.current = null;
        if (lastEmittedIndexRef.current !== null) {
          lastEmittedIndexRef.current = null;
          onHoverIndexRef.current?.(null);
        }
      },
    };
  }, [canSyncHover, scheduleHoverFlush]);

  const zrCleanupRef = useRef<(() => void) | null>(null);

  const onChartReady = useCallback(
    (chart: unknown) => {
      const raw = chart as { getEchartsInstance?: () => unknown };
      const ec = (typeof raw?.getEchartsInstance === "function" ? raw.getEchartsInstance() : chart) as {
        getZr?: () => {
          on: (e: string, h: (ev: { offsetX: number; offsetY: number }) => void) => void;
          off: (e: string, h: unknown) => void;
        };
        convertFromPixel?: (finder: unknown, point: number[]) => unknown;
      };
      zrCleanupRef.current?.();
      zrCleanupRef.current = null;
      if (!canSyncHover || !ec?.getZr) return;
      const zr = ec.getZr();
      if (!zr?.on) return;

      const handleMove = (zrEvent: { offsetX: number; offsetY: number }) => {
        const pts = profilePointsRef.current;
        const data = chartDataRef.current;
        if (!pts || !data?.length) return;
        const point = ec.convertFromPixel?.(
          { seriesIndex: 0 },
          [zrEvent.offsetX, zrEvent.offsetY]
        ) as [number, number] | null | undefined;
        if (point == null || !Array.isArray(point)) {
          if (rafIdRef.current != null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          pendingIndexRef.current = null;
          if (lastEmittedIndexRef.current !== null) {
            lastEmittedIndexRef.current = null;
            onHoverIndexRef.current?.(null);
          }
          return;
        }
        const xVal = Number(point[0]);
        if (!Number.isFinite(xVal)) {
          if (rafIdRef.current != null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          pendingIndexRef.current = null;
          if (lastEmittedIndexRef.current !== null) {
            lastEmittedIndexRef.current = null;
            onHoverIndexRef.current?.(null);
          }
          return;
        }
        let bestIdx = 0;
        let best = Math.abs(data[0]![0]! - xVal);
        for (let j = 1; j < data.length; j++) {
          const d = Math.abs(data[j]![0]! - xVal);
          if (d < best) {
            best = d;
            bestIdx = j;
          }
        }
        bestIdx = Math.max(0, Math.min(bestIdx, pts.length - 1));
        if (pendingIndexRef.current === bestIdx) return;
        pendingIndexRef.current = bestIdx;
        scheduleHoverFlushRef.current?.();
      };

      const handleOut = () => {
        if (rafIdRef.current != null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        pendingIndexRef.current = null;
        if (lastEmittedIndexRef.current !== null) {
          lastEmittedIndexRef.current = null;
          onHoverIndexRef.current?.(null);
        }
      };

      zr.on("mousemove", handleMove);
      zr.on("globalout", handleOut);
      zrCleanupRef.current = () => {
        zr.off("mousemove", handleMove);
        zr.off("globalout", handleOut);
      };
    },
    [canSyncHover]
  );

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      zrCleanupRef.current?.();
      zrCleanupRef.current = null;
      lastEmittedIndexRef.current = null;
      pendingIndexRef.current = null;
      onHoverIndexRef.current?.(null);
    };
  }, []);

  if (!curvinessData || curvinessData.length < 2) {
    return (
      <div className="flex h-full min-h-[100px] items-center justify-center rounded border border-slate-700 bg-slate-900/95 px-4 text-sm text-slate-400">
        Curviness profile not available for this track.
      </div>
    );
  }

  if (!chartData) {
    return (
      <div className="flex h-full min-h-[100px] items-center justify-center rounded border border-slate-700 bg-slate-900/95 px-4 text-sm text-slate-400">
        Curviness profile not available for this track.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded border border-slate-700 bg-slate-900/95 min-h-0">
      <div className="min-h-0 flex-1 p-1.5">
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: "100%", minHeight: 52 }}
          opts={{ renderer: "canvas" }}
          onEvents={onEvents}
          onChartReady={onChartReady}
          notMerge
        />
      </div>
    </div>
  );
}
