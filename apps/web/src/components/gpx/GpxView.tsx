"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { GpxFileRecord } from "@/lib/gpx-files";
import pb from "@/lib/pocketbase";
import { GpxUploadForm } from "./GpxUploadForm";
import { GpxFileList } from "./GpxFileList";

const MapView = dynamic(() => import("@/components/maps/MapView").then((m) => ({ default: m.MapView })), {
  ssr: false,
});

type GpxViewProps = {
  initialFiles: GpxFileRecord[];
  baseUrl: string;
};

const COLLECTION = "gpx_files";

export function GpxView({ initialFiles, baseUrl }: GpxViewProps) {
  const [files, setFiles] = useState<GpxFileRecord[]>(initialFiles);
  const [orderedFileIds, setOrderedFileIds] = useState<string[]>(() =>
    initialFiles.map((f) => f.id)
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/gpx/files");
    if (!res.ok) return;
    const list = (await res.json()) as GpxFileRecord[];
    setFiles(list);
    setOrderedFileIds(list.map((f) => f.id));
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
    .filter((f): f is GpxFileRecord => f != null);

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
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Files</h2>
          <GpxFileList
            files={files}
            orderedFileIds={orderedFileIds}
            selectedIds={selectedIds}
            onToggle={onToggle}
            onReorder={onReorder}
          />
        </section>
      </aside>
      <div className="min-w-0 flex-1">
        <MapView baseUrl={baseUrl} files={selectedFiles} className="h-full" />
      </div>
    </div>
  );
}
