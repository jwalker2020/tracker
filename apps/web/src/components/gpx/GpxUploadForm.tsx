"use client";

import { useState, useEffect } from "react";
import { enrichGpx, boundsToJson, gpxUploadSchema, isGpxFileName } from "@/lib/gpx";
import pb from "@/lib/pocketbase";

const DEFAULT_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#ef4444", "#8b5cf6",
  "#f97316", "#06b6d4", "#ec4899", "#84cc16",
];
const UPLOAD_TIMEOUT_MS = 30_000;
const SUCCESS_MESSAGE_DURATION_MS = 2_000;

type GpxUploadFormProps = {
  onUploadSuccess: () => void;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Upload timed out. Is PocketBase running at NEXT_PUBLIC_PB_URL?")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function getErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("Missing or invalid collection") || raw.includes("invalid collection context")) {
    return "gpx_files collection not loaded. Run: cd apps/pb && ./pocketbase migrate up, then restart PocketBase.";
  }
  if (err instanceof Error) return err.message;
  const o = err as { message?: string; data?: { [key: string]: { message?: string } } };
  if (o?.data) {
    const first = Object.values(o.data)[0];
    if (first?.message) return first.message;
  }
  if (typeof o?.message === "string") return o.message;
  return "Upload failed.";
}

export function GpxUploadForm({ onUploadSuccess }: GpxUploadFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [uploading, setUploading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => {
      setSuccess(false);
    }, SUCCESS_MESSAGE_DURATION_MS);
    return () => clearTimeout(t);
  }, [success]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setWarning(null);

    const fileInput = e.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
    const file = fileInput?.files?.[0];
    if (!file) {
      setError("Select a GPX file.");
      return;
    }
    if (!isGpxFileName(file.name)) {
      setError("Only .gpx files are accepted.");
      return;
    }

    const parsed = gpxUploadSchema.safeParse({
      name: name.trim() || undefined,
      color,
    });
    if (!parsed.success) {
      const first = parsed.error.flatten().fieldErrors.color?.[0]
        ?? parsed.error.flatten().fieldErrors.name?.[0]
        ?? parsed.error.message;
      setError(first ?? "Invalid input.");
      return;
    }

    setUploading(true);
    try {
      const gpxText = await file.text();
      const enriched = enrichGpx(gpxText);
      if (enriched.pointCount === 0) {
        setError("No track or route points found in the GPX file.");
        setUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", parsed.data.name ?? file.name.replace(/\.gpx$/i, ""));
      formData.append("boundsJson", boundsToJson(enriched.bounds));
      formData.append("centerLat", String(enriched.centerLat));
      formData.append("centerLng", String(enriched.centerLng));
      formData.append("trackCount", String(enriched.trackCount));
      formData.append("pointCount", String(enriched.pointCount));
      formData.append("color", parsed.data.color);
      formData.append("distanceM", String(enriched.distanceM));
      formData.append("minElevationM", String(enriched.minElevationM));
      formData.append("maxElevationM", String(enriched.maxElevationM));
      formData.append("totalAscentM", String(enriched.totalAscentM));
      formData.append("totalDescentM", String(enriched.totalDescentM));
      formData.append("averageGradePct", String(enriched.averageGradePct));
      formData.append("enrichedGeoJson", enriched.enrichedGeoJson);

      const record = await withTimeout(
        pb.collection("gpx_files").create(formData),
        UPLOAD_TIMEOUT_MS
      );
      e.currentTarget.reset();
      setName("");
      setColor(DEFAULT_COLORS[0]);
      setSuccess(true);
      onUploadSuccess();

      setEnriching(true);
      try {
        const res = await fetch("/api/gpx/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: record.id }),
        });
        const data = (await res.json()) as { ok?: boolean; warning?: string; error?: string };
        if (data.warning) setWarning(data.warning);
        if (data.ok !== false && res.ok) onUploadSuccess();
      } catch {
        setWarning("Elevation enrichment could not be completed.");
      } finally {
        setEnriching(false);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="gpx-file" className="mb-1 block text-xs font-medium text-slate-300">
          GPX file
        </label>
        <input
          id="gpx-file"
          type="file"
          accept=".gpx"
          required
          className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 file:mr-2 file:rounded file:border-0 file:bg-sky-600 file:px-2 file:py-1 file:text-slate-100"
        />
      </div>
      <div>
        <label htmlFor="gpx-name" className="mb-1 block text-xs font-medium text-slate-300">
          Name (optional)
        </label>
        <input
          id="gpx-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My track"
          className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
        />
      </div>
      <div>
        <label htmlFor="gpx-color" className="mb-1 block text-xs font-medium text-slate-300">
          Color
        </label>
        <div className="flex flex-wrap gap-2">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-slate-100 border-slate-400" : "border-slate-600"}`}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      </div>
      {error ? (
        <p className="text-xs text-red-400" role="alert">{error}</p>
      ) : null}
      {success ? (
        <p className="text-xs text-green-400" role="status">Uploaded!</p>
      ) : null}
      {enriching ? (
        <p className="text-xs text-slate-400" role="status" aria-live="polite">
          Enriching elevation from DEM…
        </p>
      ) : null}
      {warning ? (
        <p className="text-xs text-amber-400" role="status" aria-live="polite">
          {warning}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={uploading}
        className="w-full rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {uploading ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
