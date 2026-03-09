import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import pb from "@/lib/pocketbase";
import { getGpxFilesList, gpxRecordToDisplay } from "@/lib/gpx";
import { getActiveEnrichmentJobIdsForRecordIds } from "@/app/api/gpx/enrichment-checkpoint";

const COLLECTION = "gpx_files";

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_PB_URL) {
    return NextResponse.json([]);
  }
  try {
    const files = await getGpxFilesList(userId);
    const forDisplay = files.map(gpxRecordToDisplay);
    const recordIds = files.map((f) => f.id);
    const activeJobByRecordId = await getActiveEnrichmentJobIdsForRecordIds(pb, recordIds, userId);
    const withActiveJobs = forDisplay.map((f) =>
      activeJobByRecordId[f.id] ? { ...f, activeEnrichmentJobId: activeJobByRecordId[f.id] } : f
    );
    return NextResponse.json(withActiveJobs);
  } catch (err) {
    console.error("[GET /api/gpx/files]", err);
    return NextResponse.json([]);
  }
}

/**
 * PATCH /api/gpx/files
 * Body: { orderedIds: string[] }
 * Updates sortOrder for each listed record. Only allows updates for records owned by the current user.
 */
export async function PATCH(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { orderedIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : [];
  if (orderedIds.length === 0) {
    return NextResponse.json({ ok: true });
  }

  try {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (typeof id !== "string" || !id.trim()) continue;
      let record: { user?: string };
      try {
        record = await pb.collection(COLLECTION).getOne(id);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const ownerId = record.user ?? (record as { uploadedBy?: string }).uploadedBy;
      if (ownerId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await pb.collection(COLLECTION).update(id, { sortOrder: i });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/gpx/files]", err);
    return NextResponse.json({ error: "Reorder failed" }, { status: 500 });
  }
}
