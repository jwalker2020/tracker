import { getGpxFilesList } from "@/lib/gpx-files";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const files = await getGpxFilesList();
    return NextResponse.json(files);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
