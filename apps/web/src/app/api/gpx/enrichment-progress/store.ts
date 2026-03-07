/**
 * In-memory progress store for DEM enrichment jobs. Keyed by jobId.
 * Attached to globalThis so the same store is used across all route invocations
 * (avoids losing progress when modules are re-evaluated or requests hit different workers).
 */

export type EnrichmentProgressStatus = "running" | "completed" | "failed";

export type EnrichmentProgress = {
  status: EnrichmentProgressStatus;
  processedPoints: number;
  totalPoints: number;
  percentComplete: number;
  error?: string;
};

const GLOBAL_KEY = "__gpx_enrichment_progress_store";
const g = typeof globalThis !== "undefined" ? (globalThis as Record<string, Map<string, EnrichmentProgress> | undefined>) : undefined;
const store: Map<string, EnrichmentProgress> =
  g?.[GLOBAL_KEY] ?? (() => {
    const m = new Map<string, EnrichmentProgress>();
    if (g) g[GLOBAL_KEY] = m;
    return m;
  })();

export function setProgress(
  jobId: string,
  update: Partial<EnrichmentProgress>
): void {
  const current = store.get(jobId) ?? {
    status: "running" as const,
    processedPoints: 0,
    totalPoints: 0,
    percentComplete: 0,
  };
  store.set(jobId, { ...current, ...update });
}

export function getProgress(jobId: string): EnrichmentProgress | undefined {
  return store.get(jobId);
}

export function createJob(): string {
  const jobId = crypto.randomUUID();
  store.set(jobId, {
    status: "running",
    processedPoints: 0,
    totalPoints: 0,
    percentComplete: 0,
  });
  return jobId;
}
