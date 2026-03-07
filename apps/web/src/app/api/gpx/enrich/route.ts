import { NextResponse } from "next/server";
import pb from "@/lib/pocketbase";
import { enrichGpxWithDem } from "@/lib/dem";

const COLLECTION = "gpx_files";

export async function POST(request: Request) {
  let id: string;
  try {
    const body = await request.json();
    id = typeof body?.id === "string" ? body.id.trim() : "";
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

  const demBasePath = process.env.DEM_BASE_PATH;
  if (!demBasePath?.trim()) {
    return NextResponse.json({
      ok: true,
      warning: "Elevation enrichment skipped (DEM_BASE_PATH not set).",
    });
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
      warning: "Elevation enrichment skipped (NEXT_PUBLIC_PB_URL not set).",
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
      warning: "Could not load GPX file for elevation enrichment.",
    });
  }

  let result;
  try {
    result = await enrichGpxWithDem(gpxText, {
      demBasePath: demBasePath.trim(),
      manifestPath: process.env.DEM_MANIFEST_PATH?.trim() || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gpx/enrich] DEM pipeline", err);
    return NextResponse.json({
      ok: true,
      warning: `Elevation enrichment failed: ${message}`,
    });
  }

  const { stats, distanceM, profile } = result;
  const update: Record<string, unknown> = {
    minElevationM: stats.minElevationM,
    maxElevationM: stats.maxElevationM,
    totalAscentM: stats.totalAscentM,
    totalDescentM: stats.totalDescentM,
    averageGradePct: stats.averageGradePct,
    distanceM,
  };
  if (profile && profile.length > 0) {
    update.elevationProfileJson = JSON.stringify(profile);
  }

  try {
    await pb.collection(COLLECTION).update(id, update);
  } catch (err) {
    console.error("[gpx/enrich] update record", err);
    return NextResponse.json({
      ok: true,
      warning: "Elevation computed but could not save to record.",
    });
  }

  return NextResponse.json({ ok: true });
}
