import { getGpxFilesList, gpxRecordToDisplay } from "@/lib/gpx";
import { NextResponse } from "next/server";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_PB_URL) {
    return NextResponse.json([]);
  }
  try {
    const files = await getGpxFilesList();
    const forDisplay = files.map(gpxRecordToDisplay);
    return NextResponse.json(forDisplay);
  } catch (err) {
    console.error("[GET /api/gpx/files]", err);
    return NextResponse.json([]);
  }
}
