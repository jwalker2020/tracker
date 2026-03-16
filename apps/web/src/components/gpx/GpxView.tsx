"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { InfoTooltip } from "@/components/ui/info-tooltip";

const MapView = dynamic(() => import("@/components/maps/MapView").then((m) => ({ default: m.MapView })), {
  ssr: false,
});

type GpxViewProps = {
  initialFiles: GpxFileRecordForDisplay[];
  initialError?: string;
};

export function GpxView({ initialFiles, initialError }: GpxViewProps) {
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

  const lastToggledIdRef = useRef<{ id: string; at: number } | null>(null);

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
      if (next.has(id)) {
        next.delete(id);
        lastToggledIdRef.current = { id, at: Date.now() };
        return next;
      }
      const last = lastToggledIdRef.current;
      const now = Date.now();
      if (last?.id === id && now - last.at < 200) {
        return prev;
      }
      lastToggledIdRef.current = null;
      next.add(id);
      return next;
    });
  }, []);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const message =
      count === 1
        ? "Delete this GPX file? This cannot be undone."
        : `Delete ${count} selected GPX files? This cannot be undone.`;
    if (!window.confirm(message)) return;
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

  const selectedFiles = files
    .filter((f) => selectedIds.has(f.id))
    .sort((a, b) => orderedFileIds.indexOf(a.id) - orderedFileIds.indexOf(b.id));

  /** Grade is percent (0–100); clamp to avoid bad data showing as e.g. 1M%. */
  const GRADE_PCT_CLAMP = 100;
  /** Fallback elevation bounds (ft) when no selected tracks have valid elevation. */
  const FALLBACK_ELEVATION_MIN_FT = 0;
  const FALLBACK_ELEVATION_MAX_FT = 10000;
  const dataBounds = useMemo(() => {
    const tracks: {
      grade: number;
      maximumGrade: number;
      curviness: number;
      averageElevation: number;
      maximumElevation: number;
    }[] = [];
    for (const f of selectedFiles) {
      const list = f.enrichedTracks ?? [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const rawGrade =
          typeof t?.averageGradePct === "number" && Number.isFinite(t.averageGradePct)
            ? t.averageGradePct
            : NaN;
        const grade =
          Number.isFinite(rawGrade)
            ? Math.max(0, Math.min(GRADE_PCT_CLAMP, Math.max(0, rawGrade)))
            : NaN;
        const rawMaxGrade =
          typeof t?.maximumGradePct === "number" && Number.isFinite(t.maximumGradePct)
            ? t.maximumGradePct
            : NaN;
        const maximumGrade =
          Number.isFinite(rawMaxGrade)
            ? Math.max(0, Math.min(GRADE_PCT_CLAMP, rawMaxGrade))
            : NaN;
        const rawCurviness =
          typeof t?.averageCurvinessDegPerMile === "number" &&
          Number.isFinite(t.averageCurvinessDegPerMile)
            ? t.averageCurvinessDegPerMile
            : NaN;
        const curviness = Number.isFinite(rawCurviness) ? Math.max(0, rawCurviness) : NaN;
        const hasValidElevation = (t?.validCount ?? 0) > 0;
        const averageElevation =
          hasValidElevation &&
          typeof t?.averageElevationFt === "number" &&
          Number.isFinite(t.averageElevationFt)
            ? t.averageElevationFt
            : NaN;
        const maximumElevation =
          hasValidElevation &&
          typeof t?.maxElevationFt === "number" &&
          Number.isFinite(t.maxElevationFt)
            ? t.maxElevationFt
            : NaN;
        tracks.push({ grade, maximumGrade, curviness, averageElevation, maximumElevation });
      }
    }
    const grades = tracks.map((tr) => tr.grade).filter((g) => Number.isFinite(g));
    const maximumGrades = tracks.map((tr) => tr.maximumGrade).filter((g) => Number.isFinite(g));
    const curvinesses = tracks.map((tr) => tr.curviness).filter((c) => Number.isFinite(c));
    const averageElevations = tracks.map((tr) => tr.averageElevation).filter((e) => Number.isFinite(e));
    const maximumElevations = tracks.map((tr) => tr.maximumElevation).filter((e) => Number.isFinite(e));
    const gradeMin = grades.length > 0 ? Math.min(...grades) : 0;
    const gradeMax = grades.length > 0 ? Math.max(...grades) : 0;
    const maximumGradeMin = maximumGrades.length > 0 ? Math.min(...maximumGrades) : 0;
    const maximumGradeMax = maximumGrades.length > 0 ? Math.max(...maximumGrades) : 0;
    const curvinessMin = curvinesses.length > 0 ? Math.min(...curvinesses) : 0;
    const curvinessMax = curvinesses.length > 0 ? Math.max(...curvinesses) : 0;
    const averageElevationMin =
      averageElevations.length > 0 ? Math.min(...averageElevations) : FALLBACK_ELEVATION_MIN_FT;
    const averageElevationMax =
      averageElevations.length > 0 ? Math.max(...averageElevations) : FALLBACK_ELEVATION_MAX_FT;
    const maximumElevationMin =
      maximumElevations.length > 0 ? Math.min(...maximumElevations) : FALLBACK_ELEVATION_MIN_FT;
    const maximumElevationMax =
      maximumElevations.length > 0 ? Math.max(...maximumElevations) : FALLBACK_ELEVATION_MAX_FT;
    return {
      gradeMin,
      gradeMax: gradeMax > gradeMin ? gradeMax : gradeMin + 1,
      maximumGradeMin,
      maximumGradeMax: maximumGradeMax > maximumGradeMin ? maximumGradeMax : maximumGradeMin + 1,
      curvinessMin,
      curvinessMax: curvinessMax > curvinessMin ? curvinessMax : curvinessMin + 1,
      averageElevationMin,
      averageElevationMax:
        averageElevationMax > averageElevationMin ? averageElevationMax : averageElevationMin + 1,
      maximumElevationMin,
      maximumElevationMax:
        maximumElevationMax > maximumElevationMin ? maximumElevationMax : maximumElevationMin + 1,
    };
  }, [selectedFiles]);

  const [filterState, setFilterState] = useState<TrackFilterState>({
    gradeMin: 0,
    gradeMax: 1,
    maximumGradeMin: 0,
    maximumGradeMax: 1,
    curvinessMin: 0,
    curvinessMax: 1,
    averageElevationMin: 0,
    averageElevationMax: 10000,
    maximumElevationMin: 0,
    maximumElevationMax: 10000,
  });

  const selectionKey = useMemo(
    () => selectedFiles.map((f) => f.id).sort().join(","),
    [selectedFiles]
  );
  useEffect(() => {
    setFilterState({
      gradeMin: dataBounds.gradeMin,
      gradeMax: dataBounds.gradeMax,
      maximumGradeMin: dataBounds.maximumGradeMin,
      maximumGradeMax: dataBounds.maximumGradeMax,
      curvinessMin: dataBounds.curvinessMin,
      curvinessMax: dataBounds.curvinessMax,
      averageElevationMin: dataBounds.averageElevationMin,
      averageElevationMax: dataBounds.averageElevationMax,
      maximumElevationMin: dataBounds.maximumElevationMin,
      maximumElevationMax: dataBounds.maximumElevationMax,
    });
  }, [
    selectionKey,
    dataBounds.gradeMin,
    dataBounds.gradeMax,
    dataBounds.maximumGradeMin,
    dataBounds.maximumGradeMax,
    dataBounds.curvinessMin,
    dataBounds.curvinessMax,
    dataBounds.averageElevationMin,
    dataBounds.averageElevationMax,
    dataBounds.maximumElevationMin,
    dataBounds.maximumElevationMax,
  ]);

  const { visibleTrackKeys, totalTracks, visibleCount } = useMemo(() => {
    const tracks: {
      fileId: string;
      trackIndex: number;
      grade: number;
      maximumGrade: number;
      curviness: number;
      averageElevation: number;
      maximumElevation: number;
      validCount: number;
    }[] = [];
    for (const f of selectedFiles) {
      const list = f.enrichedTracks ?? [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const rawGrade =
          typeof t?.averageGradePct === "number" && Number.isFinite(t.averageGradePct)
            ? t.averageGradePct
            : NaN;
        const grade =
          Number.isFinite(rawGrade)
            ? Math.max(0, Math.min(GRADE_PCT_CLAMP, Math.max(0, rawGrade)))
            : NaN;
        const rawMaxGrade =
          typeof t?.maximumGradePct === "number" && Number.isFinite(t.maximumGradePct)
            ? t.maximumGradePct
            : NaN;
        const maximumGrade =
          Number.isFinite(rawMaxGrade)
            ? Math.max(0, Math.min(GRADE_PCT_CLAMP, rawMaxGrade))
            : NaN;
        const rawCurviness =
          typeof t?.averageCurvinessDegPerMile === "number" &&
          Number.isFinite(t.averageCurvinessDegPerMile)
            ? t.averageCurvinessDegPerMile
            : NaN;
        const curviness = Number.isFinite(rawCurviness) ? Math.max(0, rawCurviness) : NaN;
        const validCount = t?.validCount ?? 0;
        const averageElevation =
          validCount > 0 &&
          typeof t?.averageElevationFt === "number" &&
          Number.isFinite(t.averageElevationFt)
            ? t.averageElevationFt
            : NaN;
        const maximumElevation =
          validCount > 0 &&
          typeof t?.maxElevationFt === "number" &&
          Number.isFinite(t.maxElevationFt)
            ? t.maxElevationFt
            : NaN;
        tracks.push({
          fileId: f.id,
          trackIndex: i,
          grade,
          maximumGrade,
          curviness,
          averageElevation,
          maximumElevation,
          validCount,
        });
      }
    }
    const keys = new Set<string>();
    const dataGradeRange = dataBounds.gradeMax - dataBounds.gradeMin;
    const dataMaxGradeRange = dataBounds.maximumGradeMax - dataBounds.maximumGradeMin;
    const dataCurvRange = dataBounds.curvinessMax - dataBounds.curvinessMin;
    const dataAvgElevRange = dataBounds.averageElevationMax - dataBounds.averageElevationMin;
    const dataMaxElevRange = dataBounds.maximumElevationMax - dataBounds.maximumElevationMin;
    const atFullRange =
      (filterState.gradeMin <= dataBounds.gradeMin &&
        filterState.gradeMax >= dataBounds.gradeMax &&
        filterState.maximumGradeMin <= dataBounds.maximumGradeMin &&
        filterState.maximumGradeMax >= dataBounds.maximumGradeMax &&
        filterState.curvinessMin <= dataBounds.curvinessMin &&
        filterState.curvinessMax >= dataBounds.curvinessMax &&
        filterState.averageElevationMin <= dataBounds.averageElevationMin &&
        filterState.averageElevationMax >= dataBounds.averageElevationMax &&
        filterState.maximumElevationMin <= dataBounds.maximumElevationMin &&
        filterState.maximumElevationMax >= dataBounds.maximumElevationMax) ||
      (dataGradeRange <= 1 &&
        dataMaxGradeRange <= 1 &&
        dataCurvRange <= 1 &&
        dataAvgElevRange <= 1 &&
        dataMaxElevRange <= 1);
    for (const tr of tracks) {
      if (atFullRange) {
        keys.add(`${tr.fileId}-${tr.trackIndex}`);
        continue;
      }
      if (!Number.isFinite(tr.grade) || !Number.isFinite(tr.curviness)) continue;
      const maxGradeOk = Number.isFinite(tr.maximumGrade)
        ? tr.maximumGrade >= filterState.maximumGradeMin &&
          tr.maximumGrade <= filterState.maximumGradeMax
        : true;
      const elevationFilterActive =
        filterState.averageElevationMin > dataBounds.averageElevationMin ||
        filterState.averageElevationMax < dataBounds.averageElevationMax ||
        filterState.maximumElevationMin > dataBounds.maximumElevationMin ||
        filterState.maximumElevationMax < dataBounds.maximumElevationMax;
      // Exclude tracks with no valid elevation when any elevation filter is narrowed (per product spec).
      if (elevationFilterActive && tr.validCount === 0) continue;
      const avgElevOk =
        !Number.isFinite(tr.averageElevation) ||
        (tr.averageElevation >= filterState.averageElevationMin &&
          tr.averageElevation <= filterState.averageElevationMax);
      const maxElevOk =
        !Number.isFinite(tr.maximumElevation) ||
        (tr.maximumElevation >= filterState.maximumElevationMin &&
          tr.maximumElevation <= filterState.maximumElevationMax);
      if (
        tr.grade >= filterState.gradeMin &&
        tr.grade <= filterState.gradeMax &&
        maxGradeOk &&
        tr.curviness >= filterState.curvinessMin &&
        tr.curviness <= filterState.curvinessMax &&
        avgElevOk &&
        maxElevOk
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
              if (recordId) setSelectedIds((prev) => new Set([...prev, recordId]));
              // Refetch so file gets hasEnrichmentArtifact + enrichedTracksSummary. Delay so worker's DB update is visible; retry once in case of race.
              setTimeout(refetch, 200);
              setTimeout(refetch, 1500);
            }}
          />
        </section>
        <section>
          <h2 className="mb-3 flex items-center gap-0 text-sm font-semibold text-slate-100">
            Files
            <InfoTooltip
              alignLeft
              text="You can drag files to change the order in which they appear on the map. The files are drawn from the top down. You can select one or more files and click 'Zoom to selection' to set the map to zoom to the selected files."
            />
          </h2>
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
              title="Zoom map to selected tracks"
              onClick={() => setFitToSelectionTrigger((t) => t + 1)}
              className="rounded border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
              disabled={selectedIds.size === 0}
            >
              Zoom to selection
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={selectedIds.size === 0}
              className="rounded border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            >
              Clear selection
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
            onFilterChange={(patch) => setFilterState((prev) => ({ ...prev, ...patch }))}
            gradeBounds={{ dataMin: dataBounds.gradeMin, dataMax: dataBounds.gradeMax }}
            maximumGradeBounds={{
              dataMin: dataBounds.maximumGradeMin,
              dataMax: dataBounds.maximumGradeMax,
            }}
            curvinessBounds={{
              dataMin: dataBounds.curvinessMin,
              dataMax: dataBounds.curvinessMax,
            }}
            averageElevationBounds={{
              dataMin: dataBounds.averageElevationMin,
              dataMax: dataBounds.averageElevationMax,
            }}
            maximumElevationBounds={{
              dataMin: dataBounds.maximumElevationMin,
              dataMax: dataBounds.maximumElevationMax,
            }}
            totalTracks={totalTracks}
            visibleCount={visibleCount}
            onReset={() => {
              setFilterState({
                gradeMin: dataBounds.gradeMin,
                gradeMax: dataBounds.gradeMax,
                maximumGradeMin: dataBounds.maximumGradeMin,
                maximumGradeMax: dataBounds.maximumGradeMax,
                curvinessMin: dataBounds.curvinessMin,
                curvinessMax: dataBounds.curvinessMax,
                averageElevationMin: dataBounds.averageElevationMin,
                averageElevationMax: dataBounds.averageElevationMax,
                maximumElevationMin: dataBounds.maximumElevationMin,
                maximumElevationMax: dataBounds.maximumElevationMax,
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
