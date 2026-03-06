"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { GpxFileRecord } from "@/lib/gpx-files";
import { GpxUploadForm } from "./GpxUploadForm";
import { GpxFileList } from "./GpxFileList";

const MapView = dynamic(() => import("@/components/maps/MapView").then((m) => ({ default: m.MapView })), {
  ssr: false,
});

type GpxViewProps = {
  initialFiles: GpxFileRecord[];
  baseUrl: string;
};

export function GpxView({ initialFiles, baseUrl }: GpxViewProps) {
  const [files, setFiles] = useState<GpxFileRecord[]>(initialFiles);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const refetch = useCallback(async () => {
    const res = await fetch("/api/gpx/files");
    if (!res.ok) return;
    const list = (await res.json()) as GpxFileRecord[];
    setFiles(list);
  }, []);

  const onToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedFiles = files.filter((f) => selectedIds.has(f.id));

  return (
    <div className="flex h-[calc(100vh-2rem)] gap-4 overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Upload GPX</h2>
          <GpxUploadForm onUploadSuccess={refetch} />
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Files</h2>
          <GpxFileList files={files} selectedIds={selectedIds} onToggle={onToggle} />
        </section>
      </aside>
      <div className="min-w-0 flex-1">
        <MapView baseUrl={baseUrl} files={selectedFiles} className="h-full" />
      </div>
    </div>
  );
}
