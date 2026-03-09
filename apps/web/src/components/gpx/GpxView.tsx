"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { GpxFileRecordForDisplay } from "@/lib/gpx";
import { BASEMAPS, DEFAULT_BASEMAP_ID } from "@/lib/maps/basemaps";
import {
  DEFAULT_HILLSHADE_MODE,
  HILLSHADE_LAYERS,
  type HillshadeMode,
} from "@/lib/maps/overlays";

/** Default hillshade mode when user switches basemap. OSM gets ESRI hillshade; others get none. */
const HILLSHADE_FOR_BASEMAP: Record<string, HillshadeMode> = {
  osm: "esri",
  usgs: "none",
  "esri-imagery": "none",
  "carto-positron": "none",
  "stamen-terrain": "none",
};
import { GpxUploadForm } from "./GpxUploadForm";
import { GpxFileList } from "./GpxFileList";
import { TrackFilters, type TrackFilterState } from "./TrackFilters";

const MapView = dynamic(() => import("@/components/maps/MapView").then((m) => ({ default: m.MapView })), {
  ssr: false,
});

type GpxViewProps = {
  initialFiles: GpxFileRecordForDisplay[];
  baseUrl: string;
  initialError?: string;
};

export function GpxView({ initialFiles, baseUrl, initialError }: GpxViewProps) {
  const [files, setFiles] = useState<GpxFileRecordForDisplay[]>(initialFiles);
  const [orderedFileIds, setOrderedFileIds] = useState<string[]>(() =>
    initialFiles.map((f) => f.id)
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  const [fitToSelectionTrigger, setFitToSelectionTrigger] = useState(0);
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP_ID);
  const [hillshadeMode, setHillshadeMode] = useState<HillshadeMode>(DEFAULT_HILLSHADE_MODE);
  const [parcelsEnabled, setParcelsEnabled] = useState(false);
  const [activeEnrichmentByFileId, setActiveEnrichmentByFileId] = useState<Record<string, string>>(
    () => {
      const m: Record<string, string> = {};
      initialFiles.forEach((f) => {
        if (f.activeEnrichmentJobId) m[f.id] = f.activeEnrichmentJobId;
      });
      return m;
    }
  );

  const refetch = useCallback(async () => {
    setError(undefined);
    setRefetching(true);
    try {
      const res = await fetch("/api/gpx/files", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      const list = (await res.json()) as GpxFileRecordForDisplay[];
      setFiles(list);
      setOrderedFileIds(list.map((f) => f.id));
      setActiveEnrichmentByFileId((prev) => {
        const next: Record<string, string> = {};
        list.forEach((f) => {
          if (f.activeEnrichmentJobId) next[f.id] = f.activeEnrichmentJobId;
        });
        return next;
      });
    } catch {
      setError("Could not load GPX files.");
    } finally {
      setRefetching(false);
    }
  }, []);

  const onToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const ids = [...selectedIds];
      setActiveEnrichmentByFileId((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/gpx/files/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" })
        )
      );
      const failed = results.some((r) => !r.ok);
      if (failed) {
        setError("Some files could not be deleted.");
      }
      setSelectedIds(new Set());
      await refetch();
    } catch {
      setError("Could not delete files.");
    } finally {
      setDeleting(false);
    }
  }, [selectedIds, refetch]);

  const selectedFiles = orderedFileIds
    .filter((id) => selectedIds.has(id))
    .map((id) => files.find((f) => f.id === id))
    .filter((f): f is GpxFileRecordForDisplay => f != null);

  const dataBounds = useMemo(() => {
    const tracks: { grade: number; curviness: number }[] = [];
    for (const f of selectedFiles) {
      const list = f.enrichedTracks ?? [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const grade =
          typeof t?.averageGradePct === "number" && Number.isFinite(t.averageGradePct)
            ? t.averageGradePct
            : NaN;
        const curviness =
          typeof t?.averageCurvinessDegPerMile === "number" &&
          Number.isFinite(t.averageCurvinessDegPerMile)
            ? t.averageCurvinessDegPerMile
            : NaN;
        tracks.push({ grade, curviness });
      }
    }
    const grades = tracks.map((tr) => tr.grade).filter((g) => Number.isFinite(g));
    const curvinesses = tracks.map((tr) => tr.curviness).filter((c) => Number.isFinite(c));
    const gradeMin = grades.length > 0 ? Math.min(...grades) : 0;
    const gradeMax = grades.length > 0 ? Math.max(...grades) : 0;
    const curvinessMin = curvinesses.length > 0 ? Math.min(...curvinesses) : 0;
    const curvinessMax = curvinesses.length > 0 ? Math.max(...curvinesses) : 0;
    return {
      gradeMin,
      gradeMax: gradeMax > gradeMin ? gradeMax : gradeMin + 1,
      curvinessMin,
      curvinessMax: curvinessMax > curvinessMin ? curvinessMax : curvinessMin + 1,
    };
  }, [selectedFiles]);

  const [filterState, setFilterState] = useState<TrackFilterState>({
    gradeMin: 0,
    gradeMax: 1,
    curvinessMin: 0,
    curvinessMax: 1,
  });

  const selectionKey = useMemo(
    () => selectedFiles.map((f) => f.id).sort().join(","),
    [selectedFiles]
  );
  useEffect(() => {
    const gradeMin = Math.max(0, Math.min(100, dataBounds.gradeMin));
    const gradeMax = Math.max(0, Math.min(100, dataBounds.gradeMax));
    setFilterState({
      gradeMin,
      gradeMax: gradeMax > gradeMin ? gradeMax : Math.min(100, gradeMin + 1),
      curvinessMin: dataBounds.curvinessMin,
      curvinessMax: dataBounds.curvinessMax,
    });
  }, [selectionKey, dataBounds.gradeMin, dataBounds.gradeMax, dataBounds.curvinessMin, dataBounds.curvinessMax]);

  const { visibleTrackKeys, totalTracks, visibleCount } = useMemo(() => {
    const tracks: { fileId: string; trackIndex: number; grade: number; curviness: number }[] = [];
    for (const f of selectedFiles) {
      const list = f.enrichedTracks ?? [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const grade =
          typeof t?.averageGradePct === "number" && Number.isFinite(t.averageGradePct)
            ? t.averageGradePct
            : NaN;
        const curviness =
          typeof t?.averageCurvinessDegPerMile === "number" &&
          Number.isFinite(t.averageCurvinessDegPerMile)
            ? t.averageCurvinessDegPerMile
            : NaN;
        tracks.push({ fileId: f.id, trackIndex: i, grade, curviness });
      }
    }
    const keys = new Set<string>();
    const dataGradeRange = dataBounds.gradeMax - dataBounds.gradeMin;
    const dataCurvRange = dataBounds.curvinessMax - dataBounds.curvinessMin;
    const filterGradeRange = filterState.gradeMax - filterState.gradeMin;
    const filterCurvRange = filterState.curvinessMax - filterState.curvinessMin;
    const atFullRange =
      (filterState.gradeMin <= dataBounds.gradeMin &&
        filterState.gradeMax >= dataBounds.gradeMax &&
        filterState.curvinessMin <= dataBounds.curvinessMin &&
        filterState.curvinessMax >= dataBounds.curvinessMax) ||
      (dataGradeRange > 1 &&
        dataCurvRange > 1 &&
        filterGradeRange <= 1 &&
        filterCurvRange <= 1);
    for (const tr of tracks) {
      if (!Number.isFinite(tr.grade) || !Number.isFinite(tr.curviness)) continue;
      if (
        atFullRange ||
        (tr.grade >= filterState.gradeMin &&
          tr.grade <= filterState.gradeMax &&
          tr.curviness >= filterState.curvinessMin &&
          tr.curviness <= filterState.curvinessMax)
      ) {
        keys.add(`${tr.fileId}-${tr.trackIndex}`);
      }
    }
    return { visibleTrackKeys: keys, totalTracks: tracks.length, visibleCount: keys.size };
  }, [selectedFiles, filterState, dataBounds]);

  const onReorder = useCallback(
    async (newOrderedIds: string[]) => {
      setOrderedFileIds(newOrderedIds);
      try {
        const res = await fetch("/api/gpx/files", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: newOrderedIds }),
          credentials: "include",
        });
        if (!res.ok) await refetch();
      } catch {
        await refetch();
      }
    },
    [refetch]
  );

  return (
    <div className="flex h-[calc(100vh-2rem)] gap-4 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        {error ? (
          <div className="rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            {error}
          </div>
        ) : null}
        {refetching ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : null}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Upload GPX</h2>
          <GpxUploadForm
            onUploadSuccess={refetch}
            onEnrichmentStarted={(recordId, jobId) => {
              setActiveEnrichmentByFileId((prev) => ({ ...prev, [recordId]: jobId }));
            }}
            onEnrichmentComplete={(recordId) => {
              setActiveEnrichmentByFileId((prev) => {
                const next = { ...prev };
                delete next[recordId];
                return next;
              });
            }}
          />
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Files</h2>
          <GpxFileList
            files={files}
            orderedFileIds={orderedFileIds}
            selectedIds={selectedIds}
            onToggle={onToggle}
            onReorder={onReorder}
            activeEnrichmentJobByFileId={activeEnrichmentByFileId}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={selectedIds.size === 0}
              className="rounded border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            >
              Clear selection
            </button>
            <button
              type="button"
              title="Fit map to selected tracks"
              onClick={() => setFitToSelectionTrigger((t) => t + 1)}
              className="rounded border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
              disabled={selectedIds.size === 0}
            >
              Fit to selection
            </button>
          </div>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={selectedIds.size === 0 || deleting}
            className="mt-3 w-full rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-900/40 disabled:opacity-50 disabled:hover:bg-red-950/40"
          >
            {deleting ? "Deleting…" : "Delete selected"}
          </button>
        </section>
        {totalTracks > 0 && (
          <TrackFilters
            filterState={filterState}
            onFilterChange={setFilterState}
            gradeBounds={{ dataMin: dataBounds.gradeMin, dataMax: dataBounds.gradeMax }}
            curvinessBounds={{
              dataMin: dataBounds.curvinessMin,
              dataMax: dataBounds.curvinessMax,
            }}
            totalTracks={totalTracks}
            visibleCount={visibleCount}
            onReset={() => {
              const gradeMin = Math.max(0, Math.min(100, dataBounds.gradeMin));
              const gradeMax = Math.max(0, Math.min(100, dataBounds.gradeMax));
              setFilterState({
                gradeMin,
                gradeMax: gradeMax > gradeMin ? gradeMax : Math.min(100, gradeMin + 1),
                curvinessMin: dataBounds.curvinessMin,
                curvinessMax: dataBounds.curvinessMax,
              });
            }}
          />
        )}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-100">Basemap</h2>
          <select
            value={basemapId}
            onChange={(e) => {
              const newBasemapId = e.target.value;
              setBasemapId(newBasemapId);
              setHillshadeMode(HILLSHADE_FOR_BASEMAP[newBasemapId] ?? "none");
            }}
            className="w-full rounded border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs font-medium text-slate-200 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            aria-label="Select basemap"
          >
            {BASEMAPS.map((bm) => (
              <option key={bm.id} value={bm.id}>
                {bm.name}
              </option>
            ))}
          </select>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-100">Hillshade</h2>
          <select
            value={hillshadeMode}
            onChange={(e) => setHillshadeMode(e.target.value as HillshadeMode)}
            className="w-full rounded border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs font-medium text-slate-200 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            aria-label="Select hillshade overlay"
          >
            <option value="none">None</option>
            {HILLSHADE_LAYERS.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-100">Overlays</h2>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={parcelsEnabled}
              onChange={(e) => setParcelsEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-sky-600 focus:ring-sky-500"
              aria-label="Toggle NH Parcels overlay"
            />
            <span className="text-xs text-slate-200">NH Parcels</span>
          </label>
        </section>
      </aside>
      <div className="min-w-0 flex-1">
        <MapView
          baseUrl={baseUrl}
          files={selectedFiles}
          visibleTrackKeys={totalTracks > 0 ? visibleTrackKeys : null}
          fitToSelectionTrigger={fitToSelectionTrigger}
          basemapId={basemapId}
          onBasemapIdChange={setBasemapId}
          hillshadeMode={hillshadeMode}
          onHillshadeModeChange={setHillshadeMode}
          parcelsEnabled={parcelsEnabled}
          className="h-full"
        />
      </div>
    </div>
  );
}
