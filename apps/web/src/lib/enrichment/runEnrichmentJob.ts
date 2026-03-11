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

/**
 * Execute a single enrichment job. Loads job/checkpoint by jobId, validates state,
 * loads GPX, runs DEM enrichment, writes progress, handles cancellation, writes
 * final results, and marks completed/failed.
 * Safe to call for the same job from multiple places (one runner per job in practice).
 */
export async function runEnrichmentJob(
  pb: PocketBase,
  jobId: string
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
    const enrichedTracksJson = JSON.stringify(enrichedTracks);
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
