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
  return NextResponse.json({
    status: job.status,
    overallPercentComplete,
    currentPhase: job.currentPhase ?? "setup",
    currentPhasePercent: job.currentPhasePercent ?? 0,
    processedPoints: job.processedPoints,
    totalPoints: job.totalPoints,
    percentComplete: overallPercentComplete,
    ...(job.currentTrackIndex != null && { currentTrackIndex: job.currentTrackIndex }),
    ...(job.totalTracks != null && { totalTracks: job.totalTracks }),
    ...(job.startedAt && { startedAt: new Date(job.startedAt).getTime() }),
    ...(job.updatedAt && { updatedAt: new Date(job.updatedAt).getTime() }),
    ...(job.error != null && { error: job.error }),
  });
}
