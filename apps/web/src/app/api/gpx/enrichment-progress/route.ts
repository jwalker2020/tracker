import { NextResponse } from "next/server";
import { getProgress } from "./store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json(
      { error: "Missing jobId" },
      { status: 400 }
    );
  }
  const progress = getProgress(jobId);
  if (!progress) {
    return NextResponse.json(
      { error: "Unknown jobId" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    status: progress.status,
    processedPoints: progress.processedPoints,
    totalPoints: progress.totalPoints,
    percentComplete: progress.percentComplete,
    ...(progress.error != null && { error: progress.error }),
  });
}
