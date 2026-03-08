import { NextResponse } from "next/server";
import pb from "@/lib/pocketbase";
import { enrichGpxWithDemPerTrack } from "@/lib/dem";
import { createJob, getProgress, setProgress } from "@/app/api/gpx/enrichment-progress/store";
import {
  createCheckpointRecord,
  getResumableCheckpoint,
  markCheckpointCompleted,
  markCheckpointFailed,
} from "@/app/api/gpx/enrichment-checkpoint";

const COLLECTION = "gpx_files";
const DEM_LOG_INTERVAL_MS = 10_000;
const CHUNK_SIZE = 10_000;

function demLog(msg: string): void {
  try {
    process.stderr.write(`[DEM] ${msg}\n`);
  } catch {
    console.warn("[DEM]", msg);
  }
}

function startProgressLogging(jobId: string, isResume: boolean = false): void {
  const startMs = Date.now();
  const formatHhMmSs = (totalSeconds: number): string => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  demLog(isResume ? "Enrichment job resuming from checkpoint" : "Enrichment job started");
  const intervalId = setInterval(() => {
    const p = getProgress(jobId);
    if (!p) {
      clearInterval(intervalId);
      return;
    }
    if (p.status === "completed") {
      clearInterval(intervalId);
      demLog("Enrichment job completed");
      return;
    }
    if (p.status === "failed") {
      clearInterval(intervalId);
      demLog(`Enrichment job failed: ${p.error ?? "Unknown error"}`);
      return;
    }
    if (p.status !== "running") return;
    const { processedPoints, totalPoints, percentComplete } = p;
    const elapsedMs = Date.now() - startMs;
    const elapsedSec = Math.floor(elapsedMs / 1000);
    let estimatedRemaining = "";
    if (processedPoints > 0 && processedPoints < totalPoints) {
      const ratePerSec = processedPoints / (elapsedMs / 1000);
      const remainingSec = Math.round((totalPoints - processedPoints) / ratePerSec);
      estimatedRemaining = formatHhMmSs(remainingSec);
    }
    demLog(
      "Enrichment progress\n" +
        `  Processed: ${processedPoints.toLocaleString()} / ${totalPoints.toLocaleString()} points (${percentComplete}%)\n` +
        `  Elapsed: ${formatHhMmSs(elapsedSec)}\n` +
        (estimatedRemaining ? `  Estimated remaining: ${estimatedRemaining}` : "")
    );
  }, DEM_LOG_INTERVAL_MS);
}

async function runEnrichmentInBackground(
  recordId: string,
  jobId: string,
  checkpointRecordId: string | null
): Promise<void> {
  const demBasePath = process.env.DEM_BASE_PATH?.trim();
  const baseUrl = process.env.NEXT_PUBLIC_PB_URL ?? "";

  try {
    if (!demBasePath) {
      setProgress(jobId, { status: "failed", error: "DEM_BASE_PATH is not set.", percentComplete: 100 });
      return;
    }
    if (!baseUrl) {
      setProgress(jobId, { status: "failed", error: "NEXT_PUBLIC_PB_URL is not set.", percentComplete: 100 });
      return;
    }

    let record: { file: string };
    try {
      record = await pb.collection(COLLECTION).getOne(recordId);
    } catch {
      setProgress(jobId, { status: "failed", error: "Record not found.", percentComplete: 100 });
      return;
    }

    const fileUrl = `${baseUrl}/api/files/${COLLECTION}/${recordId}/${record.file}`;
    let gpxText: string;
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`File fetch ${res.status}`);
      gpxText = await res.text();
    } catch {
      setProgress(jobId, { status: "failed", error: "Could not load GPX file from storage.", percentComplete: 100 });
      return;
    }

    const result = await enrichGpxWithDemPerTrack(gpxText, {
      demBasePath,
      manifestPath: process.env.DEM_MANIFEST_PATH?.trim() || undefined,
      onProgress: ({ processedPoints, totalPoints, percentComplete }) => {
        setProgress(jobId, { processedPoints, totalPoints, percentComplete });
      },
    });

    const { enrichedTracks, aggregates } = result;
    const hasAnyValidData = enrichedTracks.some((t) => t.validCount > 0);
    if (enrichedTracks.length === 0) {
      setProgress(jobId, { status: "failed", error: "No tracks found in GPX.", percentComplete: 100 });
      try {
        await markCheckpointFailed(pb, recordId, jobId, "No tracks found in GPX.", true);
      } catch (e) {
        console.warn("[gpx/enrich] Checkpoint mark failed:", e);
      }
      return;
    }
    if (!hasAnyValidData) {
      const reason = "All samples were nodata or out of extent for every track.";
      setProgress(jobId, { status: "failed", error: reason, percentComplete: 100 });
      try {
        await markCheckpointFailed(pb, recordId, jobId, reason, true);
      } catch (e) {
        console.warn("[gpx/enrich] Checkpoint mark failed:", e);
      }
      return;
    }

    demLog("Saving enrichment results to record...");
    const update: Record<string, unknown> = {
      enrichedTracksJson: JSON.stringify(enrichedTracks),
      distanceM: aggregates.distanceM,
      minElevationM: aggregates.minElevationM,
      maxElevationM: aggregates.maxElevationM,
      totalAscentM: aggregates.totalAscentM,
      totalDescentM: aggregates.totalDescentM,
      averageGradePct: aggregates.averageGradePct,
    };
    await pb.collection(COLLECTION).update(recordId, update);
    try {
      await markCheckpointCompleted(pb, recordId, jobId);
    } catch (e) {
      console.warn("[gpx/enrich] Checkpoint mark completed failed:", e);
    }
    const totalCount = enrichedTracks.reduce((s, t) => s + t.pointCount, 0);
    setProgress(jobId, {
      status: "completed",
      processedPoints: totalCount,
      totalPoints: totalCount,
      percentComplete: 100,
    });
    demLog("Enrichment results saved. Job completed.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gpx/enrich] background job", err);
    setProgress(jobId, { status: "failed", error: message, percentComplete: 100 });
    try {
      await markCheckpointFailed(pb, recordId, jobId, message, true);
    } catch (e) {
      console.warn("[gpx/enrich] Checkpoint mark failed:", e);
    }
  }
}

export async function POST(request: Request) {
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

  const demBasePath = process.env.DEM_BASE_PATH?.trim();
  if (!demBasePath) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      warning: "Elevation enrichment skipped. Set DEM_BASE_PATH to enable DEM elevation.",
    });
  }

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
        setProgress(jobId, {
          status: "running",
          processedPoints: checkpoint.processedPoints,
          totalPoints: checkpoint.totalPoints,
          percentComplete:
            (checkpoint.totalPoints ?? 0) > 0
              ? Math.min(100, Math.round(((checkpoint.processedPoints ?? 0) / (checkpoint.totalPoints ?? 1)) * 100))
              : 0,
        });
        startProgressLogging(jobId, false);
        return NextResponse.json({ ok: true, jobId, resumed: false });
      }

      isResume = checkpoint.nextPointIndex > 0;
      setProgress(jobId, {
        status: "running",
        processedPoints: checkpoint.processedPoints,
        totalPoints: checkpoint.totalPoints,
        percentComplete:
          (checkpoint.totalPoints ?? 0) > 0
            ? Math.min(100, Math.round(((checkpoint.processedPoints ?? 0) / (checkpoint.totalPoints ?? 1)) * 100))
            : 0,
      });
    } else {
      jobId = createJob();
      isResume = false;
      try {
        const created = await createCheckpointRecord(pb, {
          jobId,
          recordId: id,
          totalPoints: 0,
          chunkSize: CHUNK_SIZE,
        });
        checkpointRecordId = created.id;
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

    startProgressLogging(jobId, isResume);
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

  let result: Awaited<ReturnType<typeof enrichGpxWithDemPerTrack>>;
  try {
    result = await enrichGpxWithDemPerTrack(gpxText, {
      demBasePath,
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

  const update: Record<string, unknown> = {
    enrichedTracksJson: JSON.stringify(enrichedTracks),
    distanceM: aggregates.distanceM,
    minElevationM: aggregates.minElevationM,
    maxElevationM: aggregates.maxElevationM,
    totalAscentM: aggregates.totalAscentM,
    totalDescentM: aggregates.totalDescentM,
    averageGradePct: aggregates.averageGradePct,
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
