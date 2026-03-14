/**
 * Stream NDJSON artifact to a temp file and build enrichmentArtifactIndex incrementally.
 * Avoids holding the full NDJSON string in memory. Node-only (fs/path/os).
 */

import fs from "fs";
import os from "os";
import path from "path";

import type { EnrichedTrackSummary } from "@/lib/dem/types";

export type IndexEntry = { trackIndex: number; start: number; length: number };

function createTempPath(): string {
  const dir = os.tmpdir();
  const name = `enrich-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.ndjson`;
  return path.join(dir, name);
}

export type NDJSONStreamWriter = {
  writeTrack(summary: EnrichedTrackSummary): void;
  finish(): Promise<{ filePath: string; index: IndexEntry[]; fileSize: number }>;
};

/**
 * Create a writer that streams NDJSON lines to a temp file and builds the index as it goes.
 * Call writeTrack(summary) for each track, then finish() to close the stream and get filePath, index, fileSize.
 */
export function createNDJSONStreamWriter(): NDJSONStreamWriter {
  const filePath = createTempPath();
  const stream = fs.createWriteStream(filePath, { encoding: "utf8", flags: "a" });
  const index: IndexEntry[] = [];
  let byteOffset = 0;

  function writeTrack(summary: EnrichedTrackSummary): void {
    const line = JSON.stringify(summary);
    const lineBytes = Buffer.byteLength(line, "utf8");
    stream.write(line);
    stream.write("\n");
    index.push({ trackIndex: index.length, start: byteOffset, length: lineBytes });
    byteOffset += lineBytes + 1;
  }

  function finish(): Promise<{ filePath: string; index: IndexEntry[]; fileSize: number }> {
    return new Promise((resolve, reject) => {
      stream.on("finish", () => {
        try {
          const stat = fs.statSync(filePath);
          resolve({ filePath, index, fileSize: stat.size });
        } catch (e) {
          reject(e);
        }
      });
      stream.on("error", reject);
      stream.end();
    });
  }

  return { writeTrack, finish };
}

/**
 * Verify that the last index entry's end position does not exceed file size.
 * Call after finish() before persisting. Throws if inconsistent.
 */
export function assertIndexConsistency(
  index: IndexEntry[],
  fileSize: number,
  context: string
): void {
  if (index.length === 0) return;
  const last = index[index.length - 1]!;
  const end = last.start + last.length;
  if (end > fileSize) {
    throw new Error(
      `[${context}] Artifact/index inconsistent: last entry end ${end} > fileSize ${fileSize}`
    );
  }
}

/**
 * Remove temp artifact file. Call in finally after upload so temp files are always cleaned up.
 * Logs on failure; does not throw.
 */
export async function ensureTempFileRemoved(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    console.warn("[enrichment-artifact] temp file cleanup failed", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
