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

  const demBasePath = process.env.DEM_BASE_PATH?.trim();
  if (!demBasePath) {
    return NextResponse.json({
      ok: true,
      warning: "Elevation enrichment skipped. Set DEM_BASE_PATH to enable DEM elevation.",
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

  let result;
  try {
    result = await enrichGpxWithDem(gpxText, {
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

  const { stats, distanceM, profile } = result;
  if (stats.validCount === 0) {
    return NextResponse.json({
      ok: true,
      warning: "No elevation data from DEM for this track (no intersecting tiles or all nodata).",
    });
  }

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
      warning: "Elevation was computed but could not be saved to the record.",
    });
  }

  return NextResponse.json({ ok: true });
}
