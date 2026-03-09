import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import pb from "@/lib/pocketbase";
import { markCheckpointCancelled } from "@/app/api/gpx/enrichment-checkpoint";

const COLLECTION = "gpx_files";

/**
 * DELETE /api/gpx/files/[id]
 * Verifies ownership, cancels any active enrichment job for the file, then deletes the record.
 * Safe and idempotent: 404 if record not found, 403 if not owner; no-op if already deleted.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing file id" }, { status: 400 });
  }

  let record: { user?: string };
  try {
    record = await pb.collection(COLLECTION).getOne(id);
  } catch {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const ownerId = record.user ?? (record as { uploadedBy?: string }).uploadedBy;
  if (ownerId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await markCheckpointCancelled(pb, id);
  } catch (e) {
    console.warn("[DELETE /api/gpx/files/:id] Cancel job failed (continuing with delete):", e);
  }

  try {
    await pb.collection(COLLECTION).delete(id);
  } catch (e) {
    console.error("[DELETE /api/gpx/files/:id]", e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
