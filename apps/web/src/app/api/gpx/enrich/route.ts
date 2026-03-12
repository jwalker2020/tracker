import { NextResponse } from "next/server";
import pb from "@/lib/pocketbase";
import { getCurrentUserId } from "@/lib/auth";
import { enrichGpxWithDemPerTrack } from "@/lib/dem";
import { buildEnhancementPerformance } from "@/lib/gpx/files";
import {
  createCheckpointRecord,
  getResumableCheckpoint,
  updateJobProgress,
} from "@/app/api/gpx/enrichment-checkpoint";
import { runEnrichmentInBackground, startProgressLogging } from "@/lib/enrichment/runEnrichment";

const COLLECTION = "gpx_files";
const CHUNK_SIZE = 10_000;
const WEIGHT_SETUP = 5;
const WEIGHT_PARSING = 5;
const WEIGHT_ENRICHMENT = 78;

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
    const workerHandlesJobs =
      process.env.DISABLE_WEB_ENRICHMENT_RESUME === "true" ||
      process.env.ENABLE_ENRICHMENT_WORKER === "true";

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
        if (!workerHandlesJobs) startProgressLogging(jobId, checkpointRecordId, false);
        return NextResponse.json({ ok: true, jobId, resumed: false });
      }

      // Resumable or stale running: worker (or instrumentation) will run it.
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
      if (workerHandlesJobs) {
        return NextResponse.json({ ok: true, jobId, resumed: true });
      }
      startProgressLogging(jobId, checkpointRecordId, true);
      return NextResponse.json({ ok: true, jobId, resumed: true });
    } else {
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
    }

    if (workerHandlesJobs) {
      return NextResponse.json({ ok: true, jobId, resumed: isResume });
    }
    startProgressLogging(jobId, checkpointRecordId, isResume);
    void runEnrichmentInBackground(id, jobId, checkpointRecordId);
    return NextResponse.json({ ok: true, jobId, resumed: isResume });
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

  const update: Record<string, unknown> = {
    enrichedTracksJson: JSON.stringify(enrichedTracks),
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
    console.error("[gpx/enrich] update record", err);
    return NextResponse.json({
      ok: true,
      warning: "Elevation was computed but could not be saved to the record.",
    });
  }

  return NextResponse.json({ ok: true });
}
