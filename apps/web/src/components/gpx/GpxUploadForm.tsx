"use client";

import { useState } from "react";
import { parseGpx, boundsToJson } from "@/lib/gpx";
import pb from "@/lib/pocketbase";

const DEFAULT_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#ef4444", "#8b5cf6",
  "#f97316", "#06b6d4", "#ec4899", "#84cc16",
];
const UPLOAD_TIMEOUT_MS = 30_000;

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
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
    const file = fileInput?.files?.[0];
    if (!file) {
      setError("Select a GPX file.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".gpx")) {
      setError("File must be a .gpx file.");
      return;
    }

    setUploading(true);
    try {
      const gpxText = await file.text();
      const parsed = parseGpx(gpxText);
      if (parsed.pointCount === 0) {
        setError("No track or route points found in the GPX file.");
        setUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name.trim() || file.name.replace(/\.gpx$/i, ""));
      formData.append("boundsJson", boundsToJson(parsed.bounds));
      formData.append("centerLat", String(parsed.centerLat));
      formData.append("centerLng", String(parsed.centerLng));
      formData.append("trackCount", String(parsed.trackCount));
      formData.append("pointCount", String(parsed.pointCount));
      formData.append("color", color);

      await withTimeout(pb.collection("gpx_files").create(formData), UPLOAD_TIMEOUT_MS);
      form.reset();
      setName("");
      setColor(DEFAULT_COLORS[0]);
      onUploadSuccess();
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
        <p className="text-xs text-red-400">{error}</p>
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
