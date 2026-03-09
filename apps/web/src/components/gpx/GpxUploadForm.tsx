"use client";

import { useState, useEffect, useRef } from "react";
import { enrichGpx, boundsToJson, gpxUploadSchema, isGpxFileName } from "@/lib/gpx";

const DEFAULT_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#ef4444", "#8b5cf6",
  "#f97316", "#06b6d4", "#ec4899", "#84cc16",
];
const UPLOAD_TIMEOUT_MS = 30_000;
const SUCCESS_MESSAGE_DURATION_MS = 2_000;
const ENRICHMENT_JOB_KEY = "gpx_enrichment_job_id";

type GpxUploadFormProps = {
  onUploadSuccess: () => void;
  /** Called when a background enrichment job starts for a newly uploaded file. */
  onEnrichmentStarted?: (recordId: string, jobId: string) => void;
  /** Called when the enrichment job for that file completes or fails (clears working icon). */
  onEnrichmentComplete?: (recordId: string) => void;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Upload timed out.")), ms);
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

export function GpxUploadForm({
  onUploadSuccess,
  onEnrichmentStarted,
  onEnrichmentComplete,
}: GpxUploadFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [uploading, setUploading] = useState(false);
  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const lastEnrichedRecordIdRef = useRef<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(ENRICHMENT_JOB_KEY);
    if (stored) setEnrichmentJobId(stored);
  }, []);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => {
      setSuccess(false);
    }, SUCCESS_MESSAGE_DURATION_MS);
    return () => clearTimeout(t);
  }, [success]);

  // Poll for enrichment job completion so we can clear state and notify parent (file list icon).
  const POLL_INTERVAL_MS = 5000;
  useEffect(() => {
    if (!enrichmentJobId) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/gpx/enrichment-progress?jobId=${encodeURIComponent(enrichmentJobId)}`, { credentials: "include" });
        if (cancelled) return;
        if (res.status === 404) {
          const recordId = lastEnrichedRecordIdRef.current;
          sessionStorage.removeItem(ENRICHMENT_JOB_KEY);
          setEnrichmentJobId(null);
          lastEnrichedRecordIdRef.current = null;
          if (recordId) onEnrichmentComplete?.(recordId);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { status: string; error?: string };
        if (cancelled) return;
        const recordId = lastEnrichedRecordIdRef.current;
        if (data.status === "completed") {
          sessionStorage.removeItem(ENRICHMENT_JOB_KEY);
          setEnrichmentJobId(null);
          lastEnrichedRecordIdRef.current = null;
          if (recordId) onEnrichmentComplete?.(recordId);
          onUploadSuccess();
          return;
        }
        if (data.status === "cancelled") {
          sessionStorage.removeItem(ENRICHMENT_JOB_KEY);
          setEnrichmentJobId(null);
          lastEnrichedRecordIdRef.current = null;
          if (recordId) onEnrichmentComplete?.(recordId);
          return;
        }
        if (data.status === "failed") {
          sessionStorage.removeItem(ENRICHMENT_JOB_KEY);
          setWarning(data.error ?? "Enrichment failed.");
          setEnrichmentJobId(null);
          lastEnrichedRecordIdRef.current = null;
          if (recordId) onEnrichmentComplete?.(recordId);
        }
      } finally {
        inFlight = false;
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enrichmentJobId, onEnrichmentComplete, onUploadSuccess]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setWarning(null);

    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
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

      const uploadRes = await withTimeout(
        fetch("/api/gpx/upload", { method: "POST", body: formData, credentials: "include" }),
        UPLOAD_TIMEOUT_MS
      );
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error ?? "Upload failed.");
      }
      const { id } = (await uploadRes.json()) as { id: string };
      const record = { id };
      form.reset();
      setName("");
      setColor(DEFAULT_COLORS[0]);
      setSuccess(true);
      onUploadSuccess();

      try {
        const res = await fetch("/api/gpx/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: record.id, async: true }),
          credentials: "include",
        });
        const data = (await res.json()) as { ok?: boolean; skipped?: boolean; warning?: string; error?: string; jobId?: string };
        if (data.skipped && data.warning) setWarning(data.warning);
        if (data.jobId) {
          sessionStorage.setItem(ENRICHMENT_JOB_KEY, data.jobId);
          setEnrichmentJobId(data.jobId);
          lastEnrichedRecordIdRef.current = record.id;
          onEnrichmentStarted?.(record.id, data.jobId);
        }
        if (data.ok === false || (!data.jobId && data.warning && !data.skipped)) setWarning(data.warning ?? "Enrichment could not be started.");
      } catch {
        setWarning("Elevation enrichment could not be started.");
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
