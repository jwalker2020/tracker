import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import pb from "@/lib/pocketbase";
import { getJobByJobId } from "../enrichment-checkpoint";

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json(
      { error: "Missing jobId" },
      { status: 400 }
    );
  }

  const job = await getJobByJobId(pb, jobId);
  if (!job) {
    return NextResponse.json(
      { error: "Unknown jobId" },
      { status: 404 }
    );
  }
  if (job.userId == null || job.userId !== userId) {
    return NextResponse.json(
      { error: "Unknown jobId" },
      { status: 404 }
    );
  }

  const overallPercentComplete =
    job.overallPercentComplete != null ? job.overallPercentComplete : 0;
  const processedPoints = job.processedPoints ?? 0;
  const totalPoints = job.totalPoints ?? 0;

  const startedAtMs = job.startedAt ? new Date(job.startedAt).getTime() : null;
  const elapsedMs =
    startedAtMs != null && Number.isFinite(startedAtMs)
      ? Math.max(0, Date.now() - startedAtMs)
      : null;

  const MIN_POINTS_FOR_ETA = 100;
  const MIN_ELAPSED_MS_FOR_ETA = 2000;
  let estimatedRemainingMs: number | null = null;
  if (
    elapsedMs != null &&
    elapsedMs >= MIN_ELAPSED_MS_FOR_ETA &&
    processedPoints >= MIN_POINTS_FOR_ETA &&
    totalPoints > processedPoints &&
    processedPoints > 0
  ) {
    const ratePerMs = processedPoints / elapsedMs;
    const remaining = totalPoints - processedPoints;
    const remainingMs = remaining / ratePerMs;
    estimatedRemainingMs = Number.isFinite(remainingMs) ? Math.max(0, Math.round(remainingMs)) : null;
  }

  return NextResponse.json({
    status: job.status,
    overallPercentComplete,
    currentPhase: job.currentPhase ?? "setup",
    currentPhasePercent: job.currentPhasePercent ?? 0,
    processedPoints,
    totalPoints,
    percentComplete: overallPercentComplete,
    elapsedMs,
    estimatedRemainingMs,
    ...(job.currentTrackIndex != null && { currentTrackIndex: job.currentTrackIndex }),
    ...(job.totalTracks != null && { totalTracks: job.totalTracks }),
    ...(job.startedAt && { startedAt: startedAtMs }),
    ...(job.updatedAt && { updatedAt: new Date(job.updatedAt).getTime() }),
    ...(job.error != null && { error: job.error }),
  });
}
