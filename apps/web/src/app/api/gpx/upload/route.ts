import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import pb from "@/lib/pocketbase";

const COLLECTION = "gpx_files";

/**
 * POST /api/gpx/upload
 * Accepts multipart/form-data (file, name, color, boundsJson, etc.).
 * Creates gpx_files record with the current user as owner (user field).
 * Returns the created record { id, ... } for the client to trigger enrichment.
 */
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  formData.append("user", userId);

  try {
    const record = await pb.collection(COLLECTION).create(formData);
    return NextResponse.json({ id: record.id });
  } catch (err) {
    console.error("[POST /api/gpx/upload]", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message.includes("Missing") ? "Invalid or missing fields." : "Upload failed." },
      { status: 500 }
    );
  }
}
