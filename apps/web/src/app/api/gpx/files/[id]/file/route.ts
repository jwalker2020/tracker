import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import pb from "@/lib/pocketbase";
import { getPocketBaseUrl } from "@/lib/pocketbase";

const COLLECTION = "gpx_files";

/**
 * GET /api/gpx/files/[id]/file
 * Returns the raw GPX file body for the given record. Same-origin proxy for map geometry
 * so the browser never talks to PocketBase directly. Enforces auth and ownership.
 */
export async function GET(
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

  let record: { file?: string; user?: string };
  try {
    record = await pb.collection(COLLECTION).getOne(id);
  } catch {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const ownerId = record.user ?? (record as { uploadedBy?: string }).uploadedBy;
  if (ownerId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fileName = record.file;
  if (!fileName) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const baseUrl = getPocketBaseUrl();
  const fileUrl = `${baseUrl}/api/files/${COLLECTION}/${id}/${fileName}`;
  let gpxText: string;
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) {
      return NextResponse.json({ error: "Could not load file" }, { status: 502 });
    }
    gpxText = await res.text();
  } catch (e) {
    console.error("[GET /api/gpx/files/:id/file]", e);
    return NextResponse.json({ error: "Could not load file" }, { status: 502 });
  }

  return new NextResponse(gpxText, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}
