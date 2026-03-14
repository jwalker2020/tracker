/**
 * Enrichment artifact storage: full enriched track detail (with 5m profiles) as a file.
 * Keeps gpx_files records small; artifact is loaded on demand for map/profile UI.
 */

import fs from "fs";
import type PocketBase from "pocketbase";
import FormData from "form-data";

const COLLECTION = "enrichment_artifacts";

function getBaseUrl(pb: PocketBase): string {
  const url =
    typeof (pb as { baseUrl?: string }).baseUrl === "string"
      ? (pb as { baseUrl: string }).baseUrl
      : (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_PB_URL) || "";
  return url.replace(/\/$/, "");
}

export type EnrichmentArtifactRecord = {
  id: string;
  recordId: string;
  userId: string | null;
  file: string;
  size: number | null;
  created: string;
  updated: string;
};

/** Error message substring indicating unique constraint violation (recordId). */
const UNIQUE_VIOLATION = "unique constraint";

/** Env: max artifact size in bytes; if set, upload fails before sending when fileSize exceeds it. */
const MAX_ARTIFACT_BYTES_ENV = "ENRICHMENT_ARTIFACT_MAX_BYTES";

function getMaxArtifactBytes(): number | null {
  const raw = typeof process !== "undefined" ? process.env[MAX_ARTIFACT_BYTES_ENV]?.trim() : "";
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Throws if ENRICHMENT_ARTIFACT_MAX_BYTES is set and fileSize exceeds it.
 * Call before starting upload so we fail fast with a clear message.
 */
export function checkArtifactSizeLimit(fileSize: number): void {
  const max = getMaxArtifactBytes();
  if (max != null && fileSize > max) {
    throw new Error(
      `Artifact size ${fileSize} exceeds ENRICHMENT_ARTIFACT_MAX_BYTES (${max}). Refusing upload.`
    );
  }
}

function getArtifactFileUrl(
  pb: PocketBase,
  item: EnrichmentArtifactRecord & { id: string }
): string | null {
  if (!item?.file) return null;
  const baseUrl = getBaseUrl(pb);
  if (!baseUrl) return null;
  return `${baseUrl}/api/files/${COLLECTION}/${item.id}/${item.file}`;
}

/** Structured error for artifact upload failures; preserves status and body for logging. */
export class ArtifactUploadError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly bodyPreview?: string
  ) {
    super(message);
    this.name = "ArtifactUploadError";
  }
}

/**
 * Save artifact by streaming the temp file to PocketBase (no full buffer in memory).
 * Upserts by recordId. Returns { id, size }. Caller must remove the temp file after this returns.
 * Enforces ENRICHMENT_ARTIFACT_MAX_BYTES if set. Throws ArtifactUploadError on upload failure.
 */
export async function saveEnrichmentArtifactFromPath(
  pb: PocketBase,
  params: { recordId: string; userId: string | null; filePath: string; fileSize: number }
): Promise<{ id: string; size: number }> {
  const { recordId, userId, filePath, fileSize } = params;
  checkArtifactSizeLimit(fileSize);

  const baseUrl = getBaseUrl(pb);
  if (!baseUrl) {
    throw new Error("PocketBase base URL not set (NEXT_PUBLIC_PB_URL or pb.baseUrl)");
  }

  const existing = await pb.collection(COLLECTION).getList(1, 1, {
    filter: `recordId = "${recordId}"`,
  });
  const item = existing.items[0] as unknown as (EnrichmentArtifactRecord & { id: string }) | undefined;
  const isUpdate = !!item;

  console.info("[enrichment-artifact] upload start", {
    recordId,
    fileSize,
    mode: isUpdate ? "update" : "create",
  });

  const form = new FormData();
  form.append("recordId", recordId);
  if (userId != null) form.append("userId", userId);
  form.append("size", String(fileSize));
  form.append("file", fs.createReadStream(filePath), {
    filename: "enrichment.ndjson",
    contentType: "application/x-ndjson",
    knownLength: fileSize,
  });

  const recordsUrl = `${baseUrl}/api/collections/${COLLECTION}/records`;
  const uploadStartMs = Date.now();

  const doUpload = async (url: string, method: "POST" | "PATCH"): Promise<{ id: string; size: number }> => {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        body: form as unknown as BodyInit,
        headers: form.getHeaders() as HeadersInit,
        duplex: "half",
      } as RequestInit);
    } catch (networkErr) {
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      console.warn("[enrichment-artifact] upload failed (network)", {
        recordId,
        statusCode: undefined,
        error: msg,
        fileSize,
        uploadMs: Date.now() - uploadStartMs,
        mode: isUpdate ? "update" : "create",
      });
      throw new ArtifactUploadError(`Artifact upload network error: ${msg}`, undefined, undefined);
    }

    const bodyText = await res.text();
    const bodyPreview = bodyText.slice(0, 300);

    if (!res.ok) {
      const statusCode = res.status;
      const is413 = statusCode === 413;
      const reason = is413
        ? "request entity too large"
        : statusCode >= 500
          ? "server error"
          : statusCode >= 400
            ? "client error"
            : "unexpected response";
      console.warn("[enrichment-artifact] upload failed", {
        recordId,
        statusCode,
        reason,
        bodyPreview: bodyPreview.slice(0, 200),
        fileSize,
        uploadMs: Date.now() - uploadStartMs,
        mode: isUpdate ? "update" : "create",
      });
      throw new ArtifactUploadError(
        `Artifact upload ${statusCode} (${reason}): ${bodyPreview.slice(0, 150)}`,
        statusCode,
        bodyPreview
      );
    }

    let record: { id: string; size?: number };
    try {
      record = JSON.parse(bodyText) as { id: string; size?: number };
    } catch {
      console.warn("[enrichment-artifact] upload response parse failed", {
        recordId,
        statusCode: res.status,
        bodyPreview: bodyPreview.slice(0, 100),
      });
      throw new ArtifactUploadError(
        `Artifact upload ${res.status}: invalid JSON response`,
        res.status,
        bodyPreview
      );
    }

    const uploadMs = Date.now() - uploadStartMs;
    const size = record.size ?? fileSize;
    console.info("[enrichment-artifact] upload complete", {
      recordId,
      artifactId: record.id,
      fileSize: size,
      uploadMs,
      mode: isUpdate ? "update" : "create",
    });
    return { id: record.id, size };
  };

  try {
    if (item) {
      return await doUpload(`${recordsUrl}/${item.id}`, "PATCH");
    }
    try {
      return await doUpload(recordsUrl, "POST");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes(UNIQUE_VIOLATION) || msg.includes("unique")) {
        const list = await pb.collection(COLLECTION).getList(1, 1, {
          filter: `recordId = "${recordId}"`,
        });
        const retryItem = list.items[0] as unknown as (EnrichmentArtifactRecord & { id: string }) | undefined;
        if (retryItem) {
          const form2 = new FormData();
          form2.append("recordId", recordId);
          if (userId != null) form2.append("userId", userId);
          form2.append("size", String(fileSize));
          form2.append("file", fs.createReadStream(filePath), {
            filename: "enrichment.ndjson",
            contentType: "application/x-ndjson",
            knownLength: fileSize,
          });
          const res = await fetch(`${recordsUrl}/${retryItem.id}`, {
            method: "PATCH",
            body: form2 as unknown as BodyInit,
            headers: form2.getHeaders() as HeadersInit,
            duplex: "half",
          } as RequestInit);
          const text = await res.text();
          if (!res.ok) {
            console.warn("[enrichment-artifact] upload failed (retry PATCH)", {
              recordId,
              statusCode: res.status,
              bodyPreview: text.slice(0, 200),
              fileSize,
              uploadMs: Date.now() - uploadStartMs,
              mode: "update",
            });
            throw new ArtifactUploadError(
              `Artifact upload PATCH ${res.status}: ${text.slice(0, 150)}`,
              res.status,
              text.slice(0, 300)
            );
          }
          const record = JSON.parse(text) as { id: string; size?: number };
          const uploadMs = Date.now() - uploadStartMs;
          console.info("[enrichment-artifact] upload complete", {
            recordId,
            artifactId: record.id,
            fileSize: record.size ?? fileSize,
            uploadMs,
            mode: "update",
          });
          return { id: record.id, size: record.size ?? fileSize };
        }
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof ArtifactUploadError) throw err;
    const uploadMs = Date.now() - uploadStartMs;
    console.warn("[enrichment-artifact] upload failed", {
      recordId,
      error: err instanceof Error ? err.message : String(err),
      fileSize,
      uploadMs,
      mode: isUpdate ? "update" : "create",
    });
    throw err;
  }
}

/**
 * Fetch artifact file URL for a record. Returns null if no artifact.
 * Used by the API route to stream the response without buffering the full body in memory.
 */
export async function getEnrichmentArtifactFileUrl(
  pb: PocketBase,
  recordId: string
): Promise<{ url: string; size: number | null } | null> {
  const list = await pb.collection(COLLECTION).getList(1, 1, {
    filter: `recordId = "${recordId}"`,
  });
  const item = list.items[0] as unknown as (EnrichmentArtifactRecord & { id: string }) | undefined;
  if (!item) return null;
  const url = getArtifactFileUrl(pb, item);
  if (!url) return null;
  return { url, size: item.size ?? null };
}

