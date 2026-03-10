/**
 * Shared enrichment runner. Used by POST /api/gpx/enrich and by startup resume (instrumentation).
 * Runs enrichment in the background and updates PocketBase progress/checkpoint.
 */

import pb from "@/lib/pocketbase";
import { enrichGpxWithDemPerTrack } from "@/lib/dem";
import { buildEnhancementPerformance } from "@/lib/gpx/files";
import {
  getCheckpointByRecordId,
  getJobByJobId,
  markCheckpointCompleted,
  markCheckpointFailed,
  updateJobProgress,
} from "@/app/api/gpx/enrichment-checkpoint";

const COLLECTION = "gpx_files";
const DEM_LOG_INTERVAL_MS = 10_000;
const PROGRESS_WRITE_THROTTLE_MS = 1_500;

const WEIGHT_SETUP = 5;
const WEIGHT_PARSING = 5;
const WEIGHT_ENRICHMENT = 78;
const WEIGHT_SAVING = 12;

function demLog(msg: string): void {
  try {
    process.stderr.write(`[DEM] ${msg}\n`);
  } catch {
    console.warn("[DEM]", msg);
  }
}

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
 * Run enrichment in the background. Updates progress and checkpoint in PocketBase.
 * Safe to call for the same job from startup resume or from the enrich route (one runner per recordId).
 */
export async function runEnrichmentInBackground(
  recordId: string,
  jobId: string,
  checkpointRecordId: string | null
): Promise<void> {
  const demBasePath = process.env.DEM_BASE_PATH?.trim();
  const baseUrl = process.env.NEXT_PUBLIC_PB_URL ?? "";
  let enhancementStartMs: number | undefined;
  let lastProgressWrite = 0;

  const writeProgress = async (update: Parameters<typeof updateJobProgress>[2]) => {
    try {
      await updateJobProgress(pb, jobId, update, checkpointRecordId);
    } catch (err) {
      demLog(
        `Progress write failed (continuing): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const isCancelled = async (): Promise<boolean> => {
    const cp = await getCheckpointByRecordId(pb, recordId);
    return cp?.status === "cancelled";
  };

  try {
    await writeProgress({
      currentPhase: "setup",
      currentPhasePercent: 0,
      overallPercentComplete: 0,
    });

    if (!demBasePath) {
      await writeProgress({ status: "failed", error: "DEM_BASE_PATH is not set." });
      return;
    }
    if (!baseUrl) {
      await writeProgress({ status: "failed", error: "NEXT_PUBLIC_PB_URL is not set." });
      return;
    }

    let record: { file: string };
    try {
      record = await pb.collection(COLLECTION).getOne(recordId);
    } catch {
      await writeProgress({ status: "failed", error: "Record not found." });
      return;
    }

    const fileUrl = `${baseUrl}/api/files/${COLLECTION}/${recordId}/${record.file}`;
    let gpxText: string;
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`File fetch ${res.status}`);
      gpxText = await res.text();
    } catch {
      await writeProgress({ status: "failed", error: "Could not load GPX file from storage." });
      return;
    }

    await writeProgress({
      currentPhase: "parsing",
      currentPhasePercent: 100,
      overallPercentComplete: WEIGHT_SETUP + WEIGHT_PARSING,
    });

    await writeProgress({
      currentPhase: "enrichment",
      currentPhasePercent: 0,
      overallPercentComplete: WEIGHT_SETUP + WEIGHT_PARSING,
    });

    enhancementStartMs = Date.now();
    let result: Awaited<ReturnType<typeof enrichGpxWithDemPerTrack>>;
    try {
      result = await enrichGpxWithDemPerTrack(gpxText, {
        demBasePath,
        manifestPath: process.env.DEM_MANIFEST_PATH?.trim() || undefined,
        isCancelled,
        onProgress: async ({ processedPoints, totalPoints, percentComplete }) => {
          if (await isCancelled()) return;
          const now = Date.now();
          if (now - lastProgressWrite < PROGRESS_WRITE_THROTTLE_MS) return;
          lastProgressWrite = now;
          const overall =
            WEIGHT_SETUP +
            WEIGHT_PARSING +
            Math.round((percentComplete / 100) * WEIGHT_ENRICHMENT);
          await writeProgress({
            processedPoints,
            totalPoints,
            currentPhase: "enrichment",
            currentPhasePercent: percentComplete,
            overallPercentComplete: Math.min(99, overall),
          });
        },
      });
    } catch (enrichErr) {
      const msg = enrichErr instanceof Error ? enrichErr.message : String(enrichErr);
      if (msg === "ENRICHMENT_CANCELLED") {
        await writeProgress({ status: "cancelled" });
        return;
      }
      throw enrichErr;
    }

    const { enrichedTracks, aggregates } = result;
    const hasAnyValidData = enrichedTracks.some((t) => t.validCount > 0);
    if (enrichedTracks.length === 0) {
      await writeProgress({ status: "failed", error: "No tracks found in GPX." });
      try {
        await markCheckpointFailed(pb, recordId, jobId, "No tracks found in GPX.", true);
      } catch (e) {
        console.warn("[gpx/enrich] Checkpoint mark failed:", e);
      }
      return;
    }
    if (!hasAnyValidData) {
      const reason = "All samples were nodata or out of extent for every track.";
      await writeProgress({ status: "failed", error: reason });
      try {
        await markCheckpointFailed(pb, recordId, jobId, reason, true);
      } catch (e) {
        console.warn("[gpx/enrich] Checkpoint mark failed:", e);
      }
      return;
    }

    if (await isCancelled()) {
      await writeProgress({ status: "cancelled" });
      return;
    }
    await writeProgress({
      currentPhase: "saving",
      currentPhasePercent: 0,
      overallPercentComplete: WEIGHT_SETUP + WEIGHT_PARSING + WEIGHT_ENRICHMENT,
      totalTracks: enrichedTracks.length,
    });

    demLog("Saving enrichment results to record...");
    const enhancementEndMs = Date.now();
    const totalPoints = enrichedTracks.reduce((s, t) => s + t.pointCount, 0);
    const performance = buildEnhancementPerformance(
      enhancementStartMs,
      enhancementEndMs,
      enrichedTracks.length,
      totalPoints,
      "completed",
      totalPoints,
      "completed"
    );
    if (await isCancelled()) {
      return;
    }
    const update: Record<string, unknown> = {
      enrichedTracksJson: JSON.stringify(enrichedTracks),
      distanceM: aggregates.distanceM,
      minElevationM: aggregates.minElevationM,
      maxElevationM: aggregates.maxElevationM,
      totalAscentM: aggregates.totalAscentM,
      totalDescentM: aggregates.totalDescentM,
      averageGradePct: aggregates.averageGradePct,
      performanceJson: JSON.stringify(performance),
    };
    await pb.collection(COLLECTION).update(recordId, update);
    await writeProgress({
      currentPhase: "saving",
      currentPhasePercent: 80,
      overallPercentComplete: WEIGHT_SETUP + WEIGHT_PARSING + WEIGHT_ENRICHMENT + Math.round(WEIGHT_SAVING * 0.8),
    });
    try {
      await markCheckpointCompleted(pb, recordId, jobId);
    } catch (e) {
      console.warn("[gpx/enrich] Checkpoint mark completed failed:", e);
    }
    await writeProgress({
      status: "completed",
      currentPhase: "completed",
      currentPhasePercent: 100,
      overallPercentComplete: 100,
      processedPoints: totalPoints,
      totalPoints: totalPoints,
    });
    demLog("Enrichment results saved. Job completed.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "ENRICHMENT_CANCELLED") {
      await writeProgress({ status: "cancelled" });
      return;
    }
    console.error("[gpx/enrich] background job", err);
    await writeProgress({ status: "failed", error: message });
    try {
      await markCheckpointFailed(pb, recordId, jobId, message, true);
    } catch (e) {
      console.warn("[gpx/enrich] Checkpoint mark failed:", e);
    }
    const enhancementEndMs = Date.now();
    if (await isCancelled()) {
      await writeProgress({ status: "cancelled" });
    } else if (enhancementStartMs != null) {
      const failedPerf = buildEnhancementPerformance(
        enhancementStartMs,
        enhancementEndMs,
        0,
        0,
        "failed",
        undefined,
        "failed"
      );
      try {
        await pb.collection(COLLECTION).update(recordId, { performanceJson: JSON.stringify(failedPerf) });
      } catch (e) {
        console.warn("[gpx/enrich] Failed to persist failure performance:", e);
      }
    }
  }
}
