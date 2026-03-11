/**
 * Enrichment orchestration. Used by POST /api/gpx/enrich (async) and startup resume (instrumentation).
 * runEnrichmentInBackground delegates to the shared job executor (runEnrichmentJob).
 */

import pb from "@/lib/pocketbase";
import { getJobByJobId } from "@/app/api/gpx/enrichment-checkpoint";
import { demLog, runEnrichmentJob } from "./runEnrichmentJob";

const DEM_LOG_INTERVAL_MS = 10_000;

export function startProgressLogging(
  jobId: string,
  checkpointRecordId: string | null,
  isResume: boolean
): void {
  const startMs = Date.now();
  const formatHhMmSs = (totalSeconds: number): string => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  demLog(isResume ? "Enrichment job resuming from checkpoint" : "Enrichment job started");
  const intervalId = setInterval(async () => {
    const job = await getJobByJobId(pb, jobId);
    if (!job) {
      clearInterval(intervalId);
      return;
    }
    if (job.status === "completed") {
      clearInterval(intervalId);
      demLog("Enrichment job completed");
      return;
    }
    if (job.status === "failed") {
      clearInterval(intervalId);
      demLog(`Enrichment job failed: ${job.error ?? job.errorMessage ?? "Unknown error"}`);
      return;
    }
    if (job.status === "cancelled") {
      clearInterval(intervalId);
      demLog("Enrichment job cancelled");
      return;
    }
    if (job.status !== "running") return;
    const overallPercentComplete = job.overallPercentComplete ?? 0;
    const currentPhase = job.currentPhase ?? "enrichment";
    const { processedPoints, totalPoints } = job;
    const elapsedMs = Date.now() - startMs;
    const elapsedSec = Math.floor(elapsedMs / 1000);
    let estimatedRemaining = "";
    if (processedPoints > 0 && processedPoints < totalPoints) {
      const ratePerSec = processedPoints / (elapsedMs / 1000);
      const remainingSec = Math.round((totalPoints - processedPoints) / ratePerSec);
      estimatedRemaining = formatHhMmSs(remainingSec);
    }
    demLog(
      `Progress: ${overallPercentComplete}% (phase: ${currentPhase})\n` +
        `  Processed: ${processedPoints.toLocaleString()} / ${totalPoints.toLocaleString()} points\n` +
        `  Elapsed: ${formatHhMmSs(elapsedSec)}\n` +
        (estimatedRemaining ? `  Estimated remaining: ${estimatedRemaining}` : "")
    );
  }, DEM_LOG_INTERVAL_MS);
}

/**
 * Run enrichment in the background. Delegates to runEnrichmentJob(pb, jobId).
 * Kept for API compatibility; callers may pass recordId and checkpointRecordId but only jobId is used.
 */
export async function runEnrichmentInBackground(
  _recordId: string,
  jobId: string,
  _checkpointRecordId: string | null
): Promise<void> {
  await runEnrichmentJob(pb, jobId);
}
