/**
 * Single job executor for DEM enrichment. Runs one enrichment job from start to finish.
 * Used by: POST /api/gpx/enrich (async path), startup resume (instrumentation), and future worker.
 * Does not depend on request/response; callable from any process with a PocketBase client.
 */

import type PocketBase from "pocketbase";
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
const PROGRESS_WRITE_THROTTLE_MS = 1_500;
/** Throttle cancellation checks so PocketBase is queried at most this often. */
const CANCEL_CACHE_MS = 1_500;

const WEIGHT_SETUP = 5;
const WEIGHT_PARSING = 5;
const WEIGHT_ENRICHMENT = 78;
const WEIGHT_SAVING = 12;

/** Shared DEM log helper; does not depend on request/response or web runtime. */
export function demLog(msg: string): void {
  try {
    process.stderr.write(`[DEM] ${msg}\n`);
  } catch {
    console.warn("[DEM]", msg);
  }
}

/** Options passed by the worker for instrumentation (memory logging, etc.). */
export type RunEnrichmentJobOptions = {
  jobId: string;
  recordId: string;
};

const MEMORY_LOG_INTERVAL_MS = 8_000;

function logMemoryUsage(context: { jobId: string; recordId: string }): void {
  try {
    const u = process.memoryUsage();
    demLog(
      `Memory jobId=${context.jobId} recordId=${context.recordId} ` +
        `rss=${Math.round(u.rss / 1024 / 1024)}MB heapUsed=${Math.round(u.heapUsed / 1024 / 1024)}MB ` +
        `heapTotal=${Math.round(u.heapTotal / 1024 / 1024)}MB external=${Math.round((u.external ?? 0) / 1024 / 1024)}MB`
    );
  } catch {
    // ignore
  }
}

/**
 * Execute a single enrichment job. Loads job/checkpoint by jobId, validates state,
 * loads GPX, runs DEM enrichment, writes progress, handles cancellation, writes
 * final results, and marks completed/failed.
 * Safe to call for the same job from multiple places (one runner per job in practice).
 */
export async function runEnrichmentJob(
  pb: PocketBase,
  jobId: string,
  options?: RunEnrichmentJobOptions | null
): Promise<void> {
  const job = await getJobByJobId(pb, jobId);
  if (!job) {
    demLog(`Enrichment job not found: ${jobId}`);
    return;
  }
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return;
  }

  const recordId = job.recordId;
  const checkpointRecordId = job.id;
  const logContext = options ?? { jobId, recordId };

  const demBasePath = process.env.DEM_BASE_PATH?.trim();
  const baseUrl = process.env.NEXT_PUBLIC_PB_URL ?? "";
  let enhancementStartMs: number | undefined;
  let lastProgressWrite = 0;
  let cancelChecksTotal = 0;
  let cancelFetchesActual = 0;
  let lastCancelCheckMs = 0;
  let cachedCancelled: boolean | null = null;
  let memoryLogIntervalId: ReturnType<typeof setInterval> | null = null;

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
    cancelChecksTotal++;
    const now = Date.now();
    if (cachedCancelled !== null && now - lastCancelCheckMs < CANCEL_CACHE_MS) {
      return cachedCancelled;
    }
    lastCancelCheckMs = now;
    cancelFetchesActual++;
    const cp = await getCheckpointByRecordId(pb, recordId);
    cachedCancelled = cp?.status === "cancelled";
    return cachedCancelled;
  };

  try {
    await writeProgress({
      currentPhase: "setup",
      currentPhasePercent: 0,
      overallPercentComplete: 0,
    });

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
    logMemoryUsage(logContext);
    memoryLogIntervalId = setInterval(() => logMemoryUsage(logContext), MEMORY_LOG_INTERVAL_MS);

    let enrichedTracksJson = "[";
    let firstTrack = true;
    let result: Awaited<ReturnType<typeof enrichGpxWithDemPerTrack>>;
    try {
      result = await enrichGpxWithDemPerTrack(gpxText, {
        demBasePath: demBasePath || undefined,
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
        onTrackComplete: (summary) => {
          if (!firstTrack) enrichedTracksJson += ",";
          enrichedTracksJson += JSON.stringify(summary);
          firstTrack = false;
        },
      });
    } catch (enrichErr) {
      if (memoryLogIntervalId != null) {
        clearInterval(memoryLogIntervalId);
        memoryLogIntervalId = null;
      }
      const msg = enrichErr instanceof Error ? enrichErr.message : String(enrichErr);
      if (msg === "ENRICHMENT_CANCELLED") {
        await writeProgress({ status: "cancelled" });
        return;
      }
      throw enrichErr;
    }

    if (memoryLogIntervalId != null) {
      clearInterval(memoryLogIntervalId);
      memoryLogIntervalId = null;
    }

    const { aggregates, trackCount = result.enrichedTracks.length, totalPoints: resultTotalPoints, hasAnyValidData: resultHasValid } = result;
    enrichedTracksJson += "]";
    const numTracks = trackCount;
    const hasAnyValidData = resultHasValid ?? result.enrichedTracks.some((t) => t.validCount > 0);
    const totalPoints = resultTotalPoints ?? result.enrichedTracks.reduce((s, t) => s + t.pointCount, 0);

    if (numTracks === 0) {
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
      totalTracks: numTracks,
    });

    demLog("Saving enrichment results to record...");
    const enhancementEndMs = Date.now();
    const performance = buildEnhancementPerformance(
      enhancementStartMs,
      enhancementEndMs,
      numTracks,
      totalPoints,
      "completed",
      totalPoints,
      "completed"
    );
    if (await isCancelled()) {
      return;
    }
    const performanceJsonStr = JSON.stringify(performance);
    const update: Record<string, unknown> = {
      enrichedTracksJson,
      performanceJson: performanceJsonStr,
    };
    const numericFields: Array<[key: string, value: number]> = [
      ["distanceM", aggregates.distanceM],
      ["minElevationM", aggregates.minElevationM],
      ["maxElevationM", aggregates.maxElevationM],
      ["totalAscentM", aggregates.totalAscentM],
      ["totalDescentM", aggregates.totalDescentM],
      ["averageGradePct", aggregates.averageGradePct],
    ];
    for (const [key, value] of numericFields) {
      if (typeof value === "number" && Number.isFinite(value)) {
        update[key] = value;
      }
    }
    try {
      await pb.collection(COLLECTION).update(recordId, update);
    } catch (updateErr: unknown) {
      const err = updateErr as { response?: { data?: unknown }; data?: unknown };
      const detail = err?.response?.data ?? err?.data;
      const detailStr = detail != null ? ` ${JSON.stringify(detail)}` : "";
      demLog(`PocketBase update failed: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}${detailStr}`);
      if (enrichedTracksJson.length > 9_000_000) {
        demLog(`enrichedTracksJson length: ${enrichedTracksJson.length} (max 10_000_000)`);
      }
      throw updateErr;
    }
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
    demLog(
      `Cancellation checks: ${cancelChecksTotal} total, ${cancelFetchesActual} PocketBase fetches (throttled)`
    );
    logMemoryUsage(logContext);
    demLog("Enrichment results saved. Job completed.");
  } catch (err) {
    if (memoryLogIntervalId != null) {
      clearInterval(memoryLogIntervalId);
      memoryLogIntervalId = null;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message === "ENRICHMENT_CANCELLED") {
      await writeProgress({ status: "cancelled" });
      return;
    }
    demLog(`Job failed jobId=${jobId} recordId=${recordId}: ${message}`);
    logMemoryUsage(logContext);
    console.error("[gpx/enrich] background job", jobId, recordId, err);
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
