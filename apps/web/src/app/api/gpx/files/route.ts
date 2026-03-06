import { getGpxFilesList } from "@/lib/gpx-files";
import { NextResponse } from "next/server";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_PB_URL) {
    return NextResponse.json([]);
  }
  try {
    const files = await getGpxFilesList();
    return NextResponse.json(files);
  } catch (err) {
    console.error("[GET /api/gpx/files]", err);
    return NextResponse.json([]);
  }
}
