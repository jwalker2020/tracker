import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import pb from "@/lib/pocketbase";
import { markCheckpointCancelled } from "../enrichment-checkpoint";

const GPX_COLLECTION = "gpx_files";

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let recordId: string;
  try {
    const body = await request.json();
    recordId = typeof body?.recordId === "string" ? body.recordId.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!recordId) {
    return NextResponse.json({ error: "Missing recordId" }, { status: 400 });
  }

  let gpxRecord: { user?: string };
  try {
    gpxRecord = await pb.collection(GPX_COLLECTION).getOne(recordId);
  } catch {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  const ownerId = gpxRecord.user ?? (gpxRecord as { uploadedBy?: string }).uploadedBy;
  if (ownerId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let cancelled = false;
  try {
    cancelled = await markCheckpointCancelled(pb, recordId);
  } catch (e) {
    console.warn("[gpx/enrichment-cancel] Failed to cancel job:", e);
  }
  if (cancelled) {
    console.warn("[gpx/enrichment-cancel] Enrichment job cancelled because GPX file was deleted");
  }
  return NextResponse.json({ ok: true, cancelled });
}
