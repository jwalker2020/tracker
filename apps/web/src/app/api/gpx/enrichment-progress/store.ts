/**
 * In-memory progress store for DEM enrichment jobs. Keyed by jobId.
 * Attached to globalThis so the same store is used across all route invocations
 * (avoids losing progress when modules are re-evaluated or requests hit different workers).
 *
 * Progress is weighted by phase so overallPercentComplete reflects the full pipeline:
 * setup → parsing → enrichment → saving → completed.
 */

export type EnrichmentProgressStatus = "running" | "completed" | "failed" | "cancelled";

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
const RECORD_TO_JOB_KEY = "__gpx_enrichment_record_to_job";
const g =
  typeof globalThis !== "undefined"
    ? (globalThis as unknown as Record<string, Map<string, EnrichmentProgress> | Map<string, string> | undefined>)
    : undefined;
const store: Map<string, EnrichmentProgress> =
  g?.[GLOBAL_KEY] ?? (() => {
    const m = new Map<string, EnrichmentProgress>();
    if (g) g[GLOBAL_KEY] = m;
    return m;
  })();
const recordIdToJobId: Map<string, string> =
  g?.[RECORD_TO_JOB_KEY] ?? (() => {
    const m = new Map<string, string>();
    if (g) g[RECORD_TO_JOB_KEY] = m;
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

export function registerJobForRecord(recordId: string, jobId: string): void {
  recordIdToJobId.set(recordId, jobId);
}

export function getJobIdForRecord(recordId: string): string | undefined {
  return recordIdToJobId.get(recordId);
}

export function unregisterJobForRecord(recordId: string): void {
  recordIdToJobId.delete(recordId);
}

/**
 * Cancel the active enrichment job for the given GPX record ID.
 * Marks progress as cancelled and removes the record from the job registry.
 * Returns true if a job was found and cancelled, false otherwise (idempotent).
 */
export function cancelJobForRecord(recordId: string): boolean {
  const jobId = recordIdToJobId.get(recordId);
  if (!jobId) return false;
  setProgress(jobId, { status: "cancelled" });
  recordIdToJobId.delete(recordId);
  return true;
}
