"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import along from "@turf/along";
import length from "@turf/length";
import { lineString } from "@turf/helpers";

/** Profile point: distance miles (d), elevation ft (e), optional map coords for hover sync. */
export type ProfilePoint = { d: number; e: number; lat?: number; lng?: number };

const MILES_TO_METERS = 1609.344;

/**
 * Resolve [lat, lng] for a profile index. Uses profile point coords when present,
 * else derives from track geometry by proportional distance. Shared for chart→map hover.
 */
export function getLatLngForIndex(
  profilePoints: ProfilePoint[] | null,
  trackPoints: [number, number][] | null | undefined,
  index: number
): [number, number] | null {
  if (!profilePoints?.length || index < 0 || index >= profilePoints.length) return null;
  const p = profilePoints[index];
  if (p?.lat != null && p?.lng != null) return [p.lat, p.lng];
  if (!trackPoints || trackPoints.length < 2 || !Number.isFinite(p?.d)) return null;
  try {
    const line = lineString(trackPoints.map(([lat, lng]) => [lng, lat]));
    const lenM = length(line, { units: "meters" });
    const last = profilePoints[profilePoints.length - 1];
    const totalMi = last?.d != null ? Number(last.d) : NaN;
    const distM =
      Number.isFinite(totalMi) && totalMi > 0
        ? (p.d / totalMi) * lenM
        : p.d * MILES_TO_METERS;
    const clamped = Math.max(0, Math.min(distM, lenM));
    const pt = along(line, clamped, { units: "meters" });
    const [lng, lat] = pt.geometry.coordinates;
    return [lat, lng];
  } catch {
    return null;
  }
}

type TrackElevationProfileProps = {
  trackName: string;
  /** Points (d = distance miles, e = elevation ft). Optional lat/lng for map hover sync. */
  profilePoints: ProfilePoint[] | null;
  /** Optional track geometry [lat, lng][] for hover fallback when profile has no coords. */
  trackPoints?: [number, number][] | null;
  /** Called with profile point index on chart hover, null on leave. Enables map highlight. */
  onHoverIndex?: (index: number | null) => void;
};

export function TrackElevationProfile({
  trackName,
  profilePoints,
  trackPoints,
  onHoverIndex,
}: TrackElevationProfileProps) {
  const hasCoords = useMemo(
    () =>
      profilePoints != null &&
      profilePoints.length > 0 &&
      profilePoints.some((p) => p.lat != null && p.lng != null),
    [profilePoints]
  );

  /** Enable hover→map sync when we have coords in profile OR track geometry to derive position. */
  const canSyncHover = Boolean(
    onHoverIndex &&
      profilePoints &&
      profilePoints.length >= 2 &&
      (hasCoords || (trackPoints != null && trackPoints.length >= 2))
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
    if (!profilePoints || profilePoints.length < 2) return null;
    return profilePoints.map((p) => [p.d, p.e] as [number, number]);
  }, [profilePoints]);

  profilePointsRef.current = profilePoints;
  chartDataRef.current = chartData;
  onHoverIndexRef.current = onHoverIndex;

  const option: EChartsOption = useMemo(() => {
    if (!chartData || chartData.length < 2) return {};
    const minD = Math.min(...chartData.map((d) => d[0]));
    const maxD = Math.max(...chartData.map((d) => d[0]));
    const minE = Math.min(...chartData.map((d) => d[1]));
    const maxE = Math.max(...chartData.map((d) => d[1]));
    const padE = (maxE - minE) * 0.05 || 10;
    return {
      backgroundColor: "transparent",
      grid: { left: 48, right: 16, top: 12, bottom: 32, containLabel: false },
      xAxis: {
        type: "value",
        name: "Distance (miles)",
        nameLocation: "middle",
        nameGap: 24,
        nameTextStyle: { color: "#94a3b8", fontSize: 10 },
        min: minD,
        max: maxD,
        axisLine: { lineStyle: { color: "#475569" } },
        splitLine: { show: false },
        axisLabel: { color: "#64748b", fontSize: 9 },
      },
      yAxis: {
        type: "value",
        name: "Elevation (ft)",
        nameLocation: "middle",
        nameGap: 36,
        nameTextStyle: { color: "#94a3b8", fontSize: 10 },
        min: minE - padE,
        max: maxE + padE,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "rgba(71, 85, 105, 0.3)" } },
        axisLabel: { color: "#64748b", fontSize: 9 },
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
          const [distMi, elevFt] = p.data as [number, number];
          return `<strong>Distance</strong> ${Number(distMi).toFixed(2)} mi<br/><strong>Elevation</strong> ${Math.round(Number(elevFt)).toLocaleString()} ft`;
        },
      },
      series: [
        {
          type: "line",
          data: chartData,
          showSymbol: false,
          triggerLineEvent: true,
          smooth: true,
          lineStyle: { color: "#38bdf8", width: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(56, 189, 248, 0.25)" },
                { offset: 1, color: "rgba(56, 189, 248, 0)" },
              ],
            },
          },
        },
      ],
    };
  }, [chartData]);

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

  if (!profilePoints || profilePoints.length < 2) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-slate-700 bg-slate-900/95 px-4 text-sm text-slate-400">
        Elevation profile not available for this track.
      </div>
    );
  }

  if (!chartData) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-slate-700 bg-slate-900/95 px-4 text-sm text-slate-400">
        Elevation profile not available for this track.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded border border-slate-700 bg-slate-900/95">
      <div className="border-b border-slate-700 px-3 py-1.5">
        <h3 className="text-sm font-medium text-slate-200">
          Elevation profile — {trackName}
        </h3>
      </div>
      <div className="min-h-0 flex-1 p-2">
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: "100%", minHeight: 160 }}
          opts={{ renderer: "canvas" }}
          onEvents={onEvents}
          onChartReady={onChartReady}
          notMerge
        />
      </div>
      {!hasCoords && (
        <p className="px-3 pb-2 text-xs text-slate-500">
          {trackPoints && trackPoints.length >= 2
            ? "Re-enrich for precise hover sync (position is derived from track)."
            : "Re-enrich this track to enable hover sync on the map."}
        </p>
      )}
    </div>
  );
}
