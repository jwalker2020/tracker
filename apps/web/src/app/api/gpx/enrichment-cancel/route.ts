import { NextResponse } from "next/server";
import { cancelJobForRecord } from "../enrichment-progress/store";
import { markCheckpointCancelled } from "../enrichment-checkpoint";
import pb from "@/lib/pocketbase";

export async function POST(request: Request) {
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

  let cancelled = false;
  try {
    const pbCancelled = await markCheckpointCancelled(pb, recordId);
    const memoryCancelled = cancelJobForRecord(recordId);
    cancelled = pbCancelled || memoryCancelled;
  } catch (e) {
    console.warn("[gpx/enrichment-cancel] Failed to cancel job:", e);
  }
  if (cancelled) {
    console.warn("[gpx/enrichment-cancel] Enrichment job cancelled because GPX file was deleted");
  }
  return NextResponse.json({ ok: true, cancelled });
}
