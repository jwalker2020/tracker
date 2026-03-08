"use client";

import { useCallback, useState } from "react";
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
import pb from "@/lib/pocketbase";
import { GpxUploadForm } from "./GpxUploadForm";
import { GpxFileList } from "./GpxFileList";
import { GpxLegend } from "./GpxLegend";

const MapView = dynamic(() => import("@/components/maps/MapView").then((m) => ({ default: m.MapView })), {
  ssr: false,
});

type GpxViewProps = {
  initialFiles: GpxFileRecordForDisplay[];
  baseUrl: string;
  initialError?: string;
};

const COLLECTION = "gpx_files";

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

  const refetch = useCallback(async () => {
    setError(undefined);
    setRefetching(true);
    try {
      const res = await fetch("/api/gpx/files");
      if (!res.ok) throw new Error("Failed to fetch");
      const list = (await res.json()) as GpxFileRecordForDisplay[];
      setFiles(list);
      setOrderedFileIds(list.map((f) => f.id));
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
      await Promise.all([...selectedIds].map((id) => pb.collection(COLLECTION).delete(id)));
      setSelectedIds(new Set());
      await refetch();
    } catch {
      // leave selection and list as is on error
    } finally {
      setDeleting(false);
    }
  }, [selectedIds, refetch]);

  const selectedFiles = orderedFileIds
    .filter((id) => selectedIds.has(id))
    .map((id) => files.find((f) => f.id === id))
    .filter((f): f is GpxFileRecordForDisplay => f != null);

  const onReorder = useCallback(
    async (newOrderedIds: string[]) => {
      setOrderedFileIds(newOrderedIds);
      try {
        await Promise.all(
          newOrderedIds.map((id, index) =>
            pb.collection(COLLECTION).update(id, { sortOrder: index })
          )
        );
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
          <GpxUploadForm onUploadSuccess={refetch} />
          <button
            type="button"
            onClick={deleteSelected}
            disabled={selectedIds.size === 0 || deleting}
            className="mt-3 w-full rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-900/40 disabled:opacity-50 disabled:hover:bg-red-950/40"
          >
            {deleting ? "Deleting…" : "Delete selected"}
          </button>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Selection</h2>
          <div className="flex flex-wrap gap-2">
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
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Files</h2>
          <GpxFileList
            files={files}
            orderedFileIds={orderedFileIds}
            selectedIds={selectedIds}
            onToggle={onToggle}
            onReorder={onReorder}
          />
        </section>
        <GpxLegend selectedFiles={selectedFiles} />
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
      </aside>
      <div className="min-w-0 flex-1">
        <MapView
          baseUrl={baseUrl}
          files={selectedFiles}
          fitToSelectionTrigger={fitToSelectionTrigger}
          basemapId={basemapId}
          onBasemapIdChange={setBasemapId}
          hillshadeMode={hillshadeMode}
          onHillshadeModeChange={setHillshadeMode}
          className="h-full"
        />
      </div>
    </div>
  );
}
