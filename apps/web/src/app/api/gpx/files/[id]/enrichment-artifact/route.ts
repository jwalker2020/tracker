import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import pb from "@/lib/pocketbase";
import { getEnrichmentArtifactFileUrl } from "@/lib/enrichment/artifact";

const COLLECTION = "gpx_files";

type IndexEntry = { trackIndex: number; start: number; length: number };

/** Read a byte range [start, start+length] from a response body stream without buffering the rest. */
async function readStreamSlice(res: Response, start: number, length: number): Promise<string> {
  const reader = res.body!.getReader();
  let skipped = 0;
  const chunks: Uint8Array[] = [];
  let collected = 0;
  try {
    while (collected < length) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      if (skipped < start) {
        const need = start - skipped;
        if (value.length <= need) {
          skipped += value.length;
          continue;
        }
        offset = need;
        skipped = start;
      }
      const take = Math.min(length - collected, value.length - offset);
      if (take > 0) {
        chunks.push(value.slice(offset, offset + take));
        collected += take;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(out);
}

/**
 * GET /api/gpx/files/[id]/enrichment-artifact?trackIndex=N
 * Returns a single track's enrichment as a JSON array of one element.
 * Requires enrichmentArtifactIndex on the record (NDJSON + index model). No full-artifact streaming.
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

  const trackIndexParam = new URL(request.url).searchParams.get("trackIndex");
  if (trackIndexParam == null || trackIndexParam.trim() === "") {
    return NextResponse.json(
      { error: "Missing trackIndex", code: "MISSING_TRACK_INDEX" },
      { status: 400 }
    );
  }
  const requestedTrackIndex = parseInt(trackIndexParam, 10);
  if (
    Number.isNaN(requestedTrackIndex) ||
    requestedTrackIndex < 0 ||
    !Number.isInteger(requestedTrackIndex)
  ) {
    return NextResponse.json(
      { error: "Invalid trackIndex (must be non-negative integer)", code: "INVALID_TRACK_INDEX" },
      { status: 400 }
    );
  }

  let record: { user?: string; enrichmentArtifactIndex?: string };
  try {
    record = await pb.collection(COLLECTION).getOne(id);
  } catch {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const ownerId = record.user ?? (record as { uploadedBy?: string }).uploadedBy;
  if (ownerId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let index: IndexEntry[] | null = null;
  if (record.enrichmentArtifactIndex?.trim()) {
    try {
      const parsed = JSON.parse(record.enrichmentArtifactIndex) as unknown;
      if (!Array.isArray(parsed)) {
        console.warn("[enrichment-artifact] Index is not an array", { fileId: id });
      } else {
        index = parsed as IndexEntry[];
      }
    } catch (e) {
      console.warn("[enrichment-artifact] Corrupt enrichmentArtifactIndex", { fileId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!index || index.length === 0) {
    console.warn("[enrichment-artifact] Missing or empty index", { fileId: id });
    return NextResponse.json(
      { error: "Enrichment artifact index missing or empty", code: "INDEX_MISSING" },
      { status: 400 }
    );
  }
  if (requestedTrackIndex >= index.length) {
    console.warn("[enrichment-artifact] trackIndex out of range", { fileId: id, trackIndex: requestedTrackIndex, indexLength: index.length });
    return NextResponse.json(
      { error: "trackIndex out of range", code: "TRACK_INDEX_OUT_OF_RANGE", indexLength: index.length },
      { status: 400 }
    );
  }

  const entry = index[requestedTrackIndex]!;
  if (
    typeof entry.start !== "number" ||
    typeof entry.length !== "number" ||
    !Number.isInteger(entry.start) ||
    !Number.isInteger(entry.length) ||
    entry.start < 0 ||
    entry.length < 0
  ) {
    console.warn("[enrichment-artifact] Invalid index entry", { fileId: id, trackIndex: requestedTrackIndex, entry });
    return NextResponse.json(
      { error: "Invalid artifact index entry (start/length)", code: "INVALID_INDEX_ENTRY" },
      { status: 400 }
    );
  }

  const info = await getEnrichmentArtifactFileUrl(pb, id);
  if (!info) {
    const rec = record as { hasEnrichmentArtifact?: boolean };
    if (rec.hasEnrichmentArtifact) {
      console.warn("[enrichment-artifact] hasEnrichmentArtifact but no artifact file", { fileId: id });
    }
    return NextResponse.json(
      { error: "Enrichment artifact not found", code: "ARTIFACT_NOT_FOUND" },
      { status: 404 }
    );
  }

  const artifactSize = info.size;
  if (artifactSize != null && typeof artifactSize === "number") {
    const sliceEnd = entry.start + entry.length;
    if (sliceEnd > artifactSize) {
      console.warn("[enrichment-artifact] Slice out of bounds", {
        fileId: id,
        trackIndex: requestedTrackIndex,
        start: entry.start,
        length: entry.length,
        sliceEnd,
        artifactSize,
      });
      return NextResponse.json(
        { error: "Slice bounds exceed artifact file size", code: "SLICE_OUT_OF_BOUNDS" },
        { status: 400 }
      );
    }
  }

  const startMs = Date.now();
  let res: Response;
  try {
    res = await fetch(info.url);
  } catch (err) {
    console.warn("[enrichment-artifact] Artifact fetch failed", { fileId: id, trackIndex: requestedTrackIndex, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to load artifact", code: "ARTIFACT_FETCH_FAILED" },
      { status: 502 }
    );
  }

  if (!res.ok) {
    console.warn("[enrichment-artifact] Artifact file not ok", { fileId: id, trackIndex: requestedTrackIndex, status: res.status });
    return NextResponse.json(
      { error: "Enrichment artifact not found", code: "ARTIFACT_NOT_FOUND" },
      { status: 404 }
    );
  }

  const slice = await readStreamSlice(res, entry.start, entry.length);
  const fetchMs = Date.now() - startMs;
  const sliceBytes = entry.length;
  const isLargeOrSlow = sliceBytes > 500_000 || fetchMs > 500;
  if (isLargeOrSlow) {
    console.info("[enrichment-artifact] slice ok", { fileId: id, trackIndex: requestedTrackIndex, sliceBytes, fetchMs });
  } else {
    console.debug("[enrichment-artifact] slice ok", { fileId: id, trackIndex: requestedTrackIndex, sliceBytes, fetchMs });
  }

  const body = `[${slice}]`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "private, max-age=60",
    "X-Artifact-Size-Bytes": String(entry.length),
    "X-Artifact-Track-Index": String(requestedTrackIndex),
  };
  return new NextResponse(body, { headers });
}
