import { NextResponse } from "next/server";
import pb from "@/lib/pocketbase";
import { getCurrentUserId } from "@/lib/auth";
import { enrichGpxWithDemPerTrack } from "@/lib/dem";
import type { EnrichedTrackSummary } from "@/lib/dem/types";
import { buildEnhancementPerformance } from "@/lib/gpx/files";
import {
  createCheckpointRecord,
  getResumableCheckpoint,
  updateJobProgress,
} from "@/app/api/gpx/enrichment-checkpoint";
import { saveEnrichmentArtifactFromPath } from "@/lib/enrichment/artifact";
import {
  assertIndexConsistency,
  createNDJSONStreamWriter,
  ensureTempFileRemoved,
} from "@/lib/enrichment/artifact-stream";

const COLLECTION = "gpx_files";
const CHUNK_SIZE = 10_000;
const WEIGHT_SETUP = 5;
const WEIGHT_PARSING = 5;
const WEIGHT_ENRICHMENT = 78;

/** Above this point count we require async enrichment (avoid 413 and timeouts). */
const SYNC_MAX_POINTS = 15_000;
/** Above this track count we require async enrichment. */
const SYNC_MAX_TRACKS = 50;

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let id: string;
  let startAsync: boolean;
  try {
    const body = await request.json();
    id = typeof body?.id === "string" ? body.id.trim() : "";
    startAsync = body?.async === true;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing record id" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  let gpxRecord: { user?: string; file?: string };
  try {
    gpxRecord = await pb.collection(COLLECTION).getOne(id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Record not found" },
      { status: 404 }
    );
  }
  const ownerId = gpxRecord.user ?? (gpxRecord as { uploadedBy?: string }).uploadedBy;
  if (ownerId !== userId) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 }
    );
  }

  const demBasePath = process.env.DEM_BASE_PATH?.trim();

  if (startAsync) {
    let checkpoint: Awaited<ReturnType<typeof getResumableCheckpoint>> = null;
    try {
      checkpoint = await getResumableCheckpoint(pb, id);
    } catch (e) {
      console.warn("[gpx/enrich] Checkpoint lookup failed (run migrations?):", e);
    }
    let jobId: string;
    let isResume: boolean;
    let checkpointRecordId: string | null = null;
    const HEARTBEAT_MAX_AGE_MS = 90_000;

    if (checkpoint) {
      jobId = checkpoint.jobId;
      checkpointRecordId = checkpoint.id;
      const heartbeatMs = checkpoint.lastHeartbeatAt
        ? Date.now() - new Date(checkpoint.lastHeartbeatAt).getTime()
        : Infinity;
      const alreadyRunning =
        checkpoint.status === "running" && Number.isFinite(heartbeatMs) && heartbeatMs < HEARTBEAT_MAX_AGE_MS;

      if (alreadyRunning) {
        return NextResponse.json({ ok: true, jobId, resumed: false });
      }

      isResume = true;
      const total = checkpoint.totalPoints ?? 0;
      const processed = checkpoint.processedPoints ?? 0;
      const phasePct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
      const overall =
        WEIGHT_SETUP + WEIGHT_PARSING + Math.round((phasePct / 100) * WEIGHT_ENRICHMENT);
      await updateJobProgress(pb, jobId, {
        status: "running",
        processedPoints: processed,
        totalPoints: total,
        currentPhase: "enrichment",
        currentPhasePercent: phasePct,
        overallPercentComplete: Math.min(99, overall),
      }, checkpointRecordId);
      return NextResponse.json({ ok: true, jobId, resumed: true });
    }

    jobId = crypto.randomUUID();
    isResume = false;
    try {
      const created = await createCheckpointRecord(pb, {
        jobId,
        recordId: id,
        userId,
        totalPoints: 0,
        chunkSize: CHUNK_SIZE,
      });
      checkpointRecordId = created.id;
      await updateJobProgress(pb, jobId, {
        status: "running",
        currentPhase: "enrichment",
        currentPhasePercent: 0,
        overallPercentComplete: WEIGHT_SETUP + WEIGHT_PARSING,
      }, checkpointRecordId);
    } catch (e: unknown) {
      const err = e as {
        response?: { message?: string; data?: Record<string, unknown> };
        data?: Record<string, unknown>;
        message?: string;
      };
      const detail = err?.response?.data ?? err?.data ?? err?.response?.message ?? err?.message ?? e;
      console.warn("[gpx/enrich] Checkpoint record create failed:", JSON.stringify(detail, null, 2));
    }
    return NextResponse.json({ ok: true, jobId, resumed: isResume });
  }

  const pointCount = Number((gpxRecord as { pointCount?: number }).pointCount) || 0;
  const trackCount = Number((gpxRecord as { trackCount?: number }).trackCount) || 0;
  if (pointCount > SYNC_MAX_POINTS || trackCount > SYNC_MAX_TRACKS) {
    console.info(
      `[gpx/enrich] Sync blocked (too large): fileId=${id} pointCount=${pointCount} trackCount=${trackCount} maxPoints=${SYNC_MAX_POINTS} maxTracks=${SYNC_MAX_TRACKS}; rerouting to async.`
    );
    const newJobId = crypto.randomUUID();
    try {
      const created = await createCheckpointRecord(pb, {
        jobId: newJobId,
        recordId: id,
        userId,
        totalPoints: 0,
        chunkSize: CHUNK_SIZE,
      });
      await updateJobProgress(pb, newJobId, {
        status: "running",
        currentPhase: "enrichment",
        currentPhasePercent: 0,
        overallPercentComplete: WEIGHT_SETUP + WEIGHT_PARSING,
      }, created.id);
    } catch (e) {
      console.warn("[gpx/enrich] Reroute to async failed (checkpoint create):", e);
      return NextResponse.json(
        {
          ok: false,
          error: "File is too large for sync enrichment. Please use async (background) enrichment.",
          rerouted: false,
          pointCount,
          trackCount,
          syncMaxPoints: SYNC_MAX_POINTS,
          syncMaxTracks: SYNC_MAX_TRACKS,
        },
        { status: 413 }
      );
    }
    return NextResponse.json({
      ok: true,
      jobId: newJobId,
      rerouted: true,
      message: "File too large for sync; enrichment started in background.",
      pointCount,
      trackCount,
    });
  }

  let record: { file: string };
  try {
    record = await pb.collection(COLLECTION).getOne(id);
  } catch (err) {
    console.error("[gpx/enrich] getOne", err);
    return NextResponse.json(
      { ok: false, error: "Record not found" },
      { status: 404 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_PB_URL ?? "";
  if (!baseUrl) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      warning: "Elevation enrichment skipped. NEXT_PUBLIC_PB_URL is not set.",
    });
  }

  const fileUrl = `${baseUrl}/api/files/${COLLECTION}/${id}/${record.file}`;
  let gpxText: string;
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`File fetch ${res.status}`);
    gpxText = await res.text();
  } catch (err) {
    console.error("[gpx/enrich] fetch file", err);
    return NextResponse.json({
      ok: true,
      warning: "Could not load GPX file from storage. Elevation was not enriched.",
    });
  }

  const syncEnhancementStartMs = Date.now();
  let result: Awaited<ReturnType<typeof enrichGpxWithDemPerTrack>>;
  try {
    result = await enrichGpxWithDemPerTrack(gpxText, {
      demBasePath: demBasePath || undefined,
      manifestPath: process.env.DEM_MANIFEST_PATH?.trim() || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gpx/enrich] DEM pipeline", err);
    return NextResponse.json({
      ok: true,
      warning: `Elevation enrichment failed. ${message}`,
    });
  }

  const { enrichedTracks, aggregates } = result;
  if (enrichedTracks.length === 0) {
    return NextResponse.json({ ok: true, warning: "No tracks found in GPX." });
  }
  const hasAnyValidData = enrichedTracks.some((t) => t.validCount > 0);
  if (!hasAnyValidData) {
    return NextResponse.json({
      ok: true,
      warning:
        "All samples were nodata or out of extent for every track. Is the track inside your DEM coverage (e.g. New Hampshire)?",
    });
  }

  const syncEnhancementEndMs = Date.now();
  const totalPointsSync = enrichedTracks.reduce((s, t) => s + t.pointCount, 0);
  const performanceSync = buildEnhancementPerformance(
    syncEnhancementStartMs,
    syncEnhancementEndMs,
    enrichedTracks.length,
    totalPointsSync,
    "completed",
    totalPointsSync,
    "completed"
  );

  const writer = createNDJSONStreamWriter();
  for (const t of enrichedTracks) {
    writer.writeTrack(t);
  }
  const { filePath: artifactPath, index: enrichmentArtifactIndex, fileSize: artifactFileSize } = await writer.finish();
  try {
    assertIndexConsistency(enrichmentArtifactIndex, artifactFileSize, "sync-enrich");
  } catch (consistencyErr) {
    console.error("[gpx/enrich] Sync artifact/index inconsistent", consistencyErr);
    await ensureTempFileRemoved(artifactPath);
    return NextResponse.json(
      { ok: false, error: "Artifact index inconsistent." },
      { status: 503 }
    );
  }
  const enrichedTracksSummaryCompact = enrichedTracks.map(({ elevationProfileJson: _e, ...c }) => c);

  try {
    const { size: artifactSize } = await saveEnrichmentArtifactFromPath(pb, {
      recordId: id,
      userId,
      filePath: artifactPath,
      fileSize: artifactFileSize,
    });
    console.info(
      `[gpx/enrich] Sync artifact persisted fileId=${id} size=${(artifactSize / 1024).toFixed(1)}KB tracks=${enrichedTracks.length}`
    );
  } catch (err) {
    console.error("[gpx/enrich] Sync artifact save failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Enrichment was computed but could not be saved (artifact storage failed).",
      },
      { status: 503 }
    );
  } finally {
    await ensureTempFileRemoved(artifactPath);
  }

  // Only update gpx_files after artifact success; keeps hasEnrichmentArtifact/summary consistent.
  const update: Record<string, unknown> = {
    enrichedTracksSummary: JSON.stringify(enrichedTracksSummaryCompact),
    hasEnrichmentArtifact: true,
    enrichmentArtifactIndex: JSON.stringify(enrichmentArtifactIndex),
    enrichedTracksJson: "",
    distanceM: aggregates.distanceM,
    minElevationM: aggregates.minElevationM,
    maxElevationM: aggregates.maxElevationM,
    totalAscentM: aggregates.totalAscentM,
    totalDescentM: aggregates.totalDescentM,
    averageGradePct: aggregates.averageGradePct,
    performanceJson: JSON.stringify(performanceSync),
  };

  try {
    await pb.collection(COLLECTION).update(id, update);
  } catch (err) {
    console.error("[gpx/enrich] Sync update record failed", err);
    return NextResponse.json({
      ok: false,
      error: "Enrichment was saved to artifact but record update failed.",
    }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
