"use client";

import { useState, useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 5000;

export type EnrichmentProgressProps = {
  jobId: string;
  onComplete: () => void;
  onError: (message: string) => void;
};

type ProgressState = {
  status: "running" | "completed" | "failed";
  processedPoints: number;
  totalPoints: number;
  percentComplete: number;
  error?: string;
};

export function EnrichmentProgress({ jobId, onComplete, onError }: EnrichmentProgressProps) {
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const res = await fetch(`/api/gpx/enrichment-progress?jobId=${encodeURIComponent(jobId)}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (res.status === 404) {
          if (intervalId != null) clearInterval(intervalId);
          onErrorRef.current("Enrichment job was lost. The server may have restarted.");
          return;
        }
        if (!res.ok) return;

        const data = (await res.json()) as ProgressState;
        if (cancelled) return;
        setProgress(data);

        if (data.status === "completed") {
          if (intervalId != null) clearInterval(intervalId);
          onCompleteRef.current();
          return;
        }
        if (data.status === "failed") {
          if (intervalId != null) clearInterval(intervalId);
          onErrorRef.current(data.error ?? "Enrichment failed.");
          return;
        }
      } catch {
        if (cancelled) return;
      } finally {
        inFlight = false;
      }
    };

    poll();
    intervalId = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId != null) clearInterval(intervalId);
    };
  }, [jobId]);

  if (progress?.status === "failed") {
    return (
      <div className="rounded border border-red-900/50 bg-red-950/30 px-3 py-2" role="alert">
        <p className="text-xs font-medium text-red-400">Elevation enrichment failed</p>
        <p className="text-xs text-red-300/90">{progress.error ?? "Unknown error"}</p>
      </div>
    );
  }

  if (progress?.status === "completed") {
    return null;
  }

  const pct = progress?.percentComplete ?? 0;
  const processed = progress?.processedPoints ?? 0;
  const total = progress?.totalPoints ?? 0;

  return (
    <div className="space-y-2 rounded border border-slate-600 bg-slate-800/50 px-3 py-2" role="status" aria-live="polite">
      <p className="text-xs font-medium text-slate-300">Processing GPX elevation data</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-600">
        <div
          className="h-full rounded-full bg-sky-600 transition-[width] duration-300 ease-out dark:bg-sky-500"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <p className="text-xs text-slate-400">
        {pct}% {total > 0 ? ` · ${processed.toLocaleString()} / ${total.toLocaleString()} points` : ""}
      </p>
    </div>
  );
}
