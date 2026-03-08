/**
 * In-memory progress store for DEM enrichment jobs. Keyed by jobId.
 * Attached to globalThis so the same store is used across all route invocations
 * (avoids losing progress when modules are re-evaluated or requests hit different workers).
 *
 * Progress is weighted by phase so overallPercentComplete reflects the full pipeline:
 * setup → parsing → enrichment → saving → completed.
 */

export type EnrichmentProgressStatus = "running" | "completed" | "failed";

export type EnrichmentProgressPhase =
  | "setup"
  | "parsing"
  | "enrichment"
  | "saving"
  | "completed";

export type EnrichmentProgress = {
  status: EnrichmentProgressStatus;
  /** Weighted 0–100 across the full pipeline. */
  overallPercentComplete: number;
  /** Current phase label. */
  currentPhase: EnrichmentProgressPhase;
  /** 0–100 within the current phase. */
  currentPhasePercent: number;
  processedPoints: number;
  totalPoints: number;
  /** @deprecated Use overallPercentComplete. Kept for backward compatibility. */
  percentComplete: number;
  currentTrackIndex?: number;
  totalTracks?: number;
  startedAt?: number;
  updatedAt?: number;
  error?: string;
};

const GLOBAL_KEY = "__gpx_enrichment_progress_store";
const g =
  typeof globalThis !== "undefined"
    ? (globalThis as unknown as Record<string, Map<string, EnrichmentProgress> | undefined>)
    : undefined;
const store: Map<string, EnrichmentProgress> =
  g?.[GLOBAL_KEY] ?? (() => {
    const m = new Map<string, EnrichmentProgress>();
    if (g) g[GLOBAL_KEY] = m;
    return m;
  })();

const DEFAULT_PROGRESS: EnrichmentProgress = {
  status: "running",
  overallPercentComplete: 0,
  currentPhase: "setup",
  currentPhasePercent: 0,
  processedPoints: 0,
  totalPoints: 0,
  percentComplete: 0,
  startedAt: undefined,
  updatedAt: undefined,
};

export function setProgress(
  jobId: string,
  update: Partial<EnrichmentProgress>
): void {
  const now = Date.now();
  const current = store.get(jobId) ?? { ...DEFAULT_PROGRESS, startedAt: now, updatedAt: now };
  const next = { ...current, ...update, updatedAt: now };
  if (typeof next.percentComplete === "number" && typeof next.overallPercentComplete !== "number") {
    next.overallPercentComplete = next.percentComplete;
  }
  if (typeof next.overallPercentComplete === "number") {
    next.percentComplete = next.overallPercentComplete;
  }
  store.set(jobId, next);
}

export function getProgress(jobId: string): EnrichmentProgress | undefined {
  return store.get(jobId);
}

export function createJob(): string {
  const jobId = crypto.randomUUID();
  const now = Date.now();
  store.set(jobId, {
    ...DEFAULT_PROGRESS,
    startedAt: now,
    updatedAt: now,
  });
  return jobId;
}
