"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { ProfilePoint } from "./TrackElevationProfile";

export type GradePoint = { d: number; g: number };

type TrackGradeProfileProps = {
  trackName: string;
  profilePoints: ProfilePoint[] | null;
  gradeData: GradePoint[] | null;
  trackPoints?: [number, number][] | null;
  distanceRange?: { minD: number; maxD: number } | null;
  hoveredIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  onZoomRange?: (minD: number, maxD: number) => void;
  onResetZoom?: () => void;
  isZoomed?: boolean;
  baseDistanceRange?: { minD: number; maxD: number } | null;
};

export function TrackGradeProfile({
  trackName,
  profilePoints,
  gradeData,
  trackPoints,
  distanceRange = null,
  hoveredIndex = null,
  onHoverIndex,
  onZoomRange,
  onResetZoom,
  isZoomed = false,
  baseDistanceRange = null,
}: TrackGradeProfileProps) {
  const canSyncHover = Boolean(
    onHoverIndex &&
      profilePoints &&
      profilePoints.length >= 2 &&
      gradeData &&
      gradeData.length >= 2
  );

  const chartRef = useRef<ReactECharts>(null);
  const profilePointsRef = useRef(profilePoints);
  const chartDataRef = useRef<[number, number][] | null>(null);
  const onHoverIndexRef = useRef(onHoverIndex);
  const lastEmittedIndexRef = useRef<number | null>(null);
  const pendingIndexRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const scheduleHoverFlushRef = useRef<() => void>(() => {});
  const draggingRef = useRef(false);
  const zoomStartDataXRef = useRef<number | null>(null);
  const zoomEndPixelRef = useRef<[number, number] | null>(null);
  const onZoomRangeRef = useRef(onZoomRange);
  const onResetZoomRef = useRef(onResetZoom);
  const isZoomedRef = useRef(isZoomed);
  const baseDistanceRangeRef = useRef(baseDistanceRange);
  onZoomRangeRef.current = onZoomRange;
  onResetZoomRef.current = onResetZoom;
  isZoomedRef.current = isZoomed;
  baseDistanceRangeRef.current = baseDistanceRange;

  const chartData = useMemo(() => {
    if (!gradeData || gradeData.length < 2) return null;
    return gradeData.map((p) => [p.d, Math.abs(p.g)] as [number, number]);
  }, [gradeData]);

  profilePointsRef.current = profilePoints;
  chartDataRef.current = chartData;
  onHoverIndexRef.current = onHoverIndex;

  const hoverMarkLine = useMemo(() => {
    if (hoveredIndex == null || !profilePoints?.length || hoveredIndex < 0 || hoveredIndex >= profilePoints.length)
      return undefined;
    const d = profilePoints[hoveredIndex]?.d;
    if (d == null || !Number.isFinite(d)) return undefined;
    const g =
      gradeData && hoveredIndex >= 0 && hoveredIndex < gradeData.length
        ? gradeData[hoveredIndex]?.g
        : undefined;
    const labelText =
      g != null && Number.isFinite(g) ? `${Math.abs(Number(g)).toFixed(1)}%` : "";
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
  }, [hoveredIndex, profilePoints, gradeData]);

  const option: EChartsOption = useMemo(() => {
    if (!chartData || chartData.length < 2) return {};
    const minD =
      distanceRange != null ? distanceRange.minD : Math.min(...chartData.map((d) => d[0]));
    const maxD =
      distanceRange != null ? distanceRange.maxD : Math.max(...chartData.map((d) => d[0]));
    const minG = Math.min(...chartData.map((d) => d[1]));
    const maxG = Math.max(...chartData.map((d) => d[1]));
    const padG = (maxG - minG) * 0.05 || 1;
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
        name: "Grade",
        nameLocation: "middle",
        nameGap: 40,
        nameTextStyle: { color: "#94a3b8", fontSize: 16 },
        min: Math.max(0, minG - padG),
        max: maxG + padG,
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
          const [distMi, g] = p.data as [number, number];
          return `<strong>Distance</strong> ${Number(distMi).toFixed(2)} mi<br/><strong>Grade</strong> ${Number(g).toFixed(1)}%`;
        },
      },
      series: [
        {
          type: "line",
          data: chartData,
          showSymbol: false,
          triggerLineEvent: true,
          smooth: true,
          lineStyle: { color: "#34d399", width: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(52, 211, 153, 0.25)" },
                { offset: 1, color: "rgba(52, 211, 153, 0)" },
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
      if (!ec?.getZr) return;
      const zr = ec.getZr();
      if (!zr?.on) return;

      const handleMove = (zrEvent: { offsetX: number; offsetY: number }) => {
        if (draggingRef.current) {
          zoomEndPixelRef.current = [zrEvent.offsetX, zrEvent.offsetY];
          return;
        }
        if (!canSyncHover) return;
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

      const handleMouseDown = (zrEvent: { offsetX: number; offsetY: number }) => {
        if (!onZoomRangeRef.current) return;
        const point = ec.convertFromPixel?.(
          { seriesIndex: 0 },
          [zrEvent.offsetX, zrEvent.offsetY]
        ) as [number, number] | null | undefined;
        if (point == null || !Array.isArray(point)) return;
        const xVal = Number(point[0]);
        if (!Number.isFinite(xVal)) return;
        draggingRef.current = true;
        zoomStartDataXRef.current = xVal;
        zoomEndPixelRef.current = [zrEvent.offsetX, zrEvent.offsetY];
      };

      const handleMouseUp = () => {
        if (!draggingRef.current) return;
        const startX = zoomStartDataXRef.current;
        draggingRef.current = false;
        zoomStartDataXRef.current = null;
        const endPixel = zoomEndPixelRef.current;
        zoomEndPixelRef.current = null;
        if (startX == null || !endPixel || !onZoomRangeRef.current) return;
        const point = ec.convertFromPixel?.(
          { seriesIndex: 0 },
          endPixel
        ) as [number, number] | null | undefined;
        if (point == null || !Array.isArray(point)) return;
        const endX = Number(point[0]);
        if (!Number.isFinite(endX)) return;
        let minD = Math.min(startX, endX);
        let maxD = Math.max(startX, endX);
        const base = baseDistanceRangeRef.current;
        const fullSpan = base ? base.maxD - base.minD : maxD - minD;
        const minSpan = Math.max(0.001, fullSpan * 0.005);
        if (maxD - minD < minSpan) return;
        onZoomRangeRef.current(minD, maxD);
      };

      const handleGlobalOut = () => {
        if (draggingRef.current) {
          draggingRef.current = false;
          zoomStartDataXRef.current = null;
          zoomEndPixelRef.current = null;
        }
        if (canSyncHover) handleOut();
      };

      const handleDblClick = () => {
        if (isZoomedRef.current && onResetZoomRef.current) {
          onResetZoomRef.current();
        }
      };

      zr.on("mousemove", handleMove);
      zr.on("globalout", handleGlobalOut);
      if (onZoomRange || onResetZoom) {
        zr.on("mousedown", handleMouseDown);
        zr.on("mouseup", handleMouseUp);
        zr.on("dblclick", handleDblClick);
      }
      zrCleanupRef.current = () => {
        zr.off("mousemove", handleMove);
        zr.off("globalout", handleGlobalOut);
        zr.off("mousedown", handleMouseDown);
        zr.off("mouseup", handleMouseUp);
        zr.off("dblclick", handleDblClick);
      };
    },
    [canSyncHover, onZoomRange, onResetZoom]
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

  if (!gradeData || gradeData.length < 2) {
    return (
      <div className="flex h-full min-h-[100px] items-center justify-center rounded border border-slate-700 bg-slate-900/95 px-4 text-sm text-slate-400">
        Grade profile not available for this track.
      </div>
    );
  }

  if (!chartData) {
    return (
      <div className="flex h-full min-h-[100px] items-center justify-center rounded border border-slate-700 bg-slate-900/95 px-4 text-sm text-slate-400">
        Grade profile not available for this track.
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
