/**
 * Lightweight PocketBase-backed checkpoints for DEM enrichment jobs.
 * Used to resume after crash/restart without storing millions of points.
 */

import type PocketBase from "pocketbase";

const COLLECTION = "enrichment_jobs";

export type EnrichmentJobStatus = "pending" | "running" | "completed" | "failed" | "resumable" | "cancelled";

export type EnrichmentCheckpoint = {
  jobId: string;
  recordId: string;
  status: EnrichmentJobStatus;
  totalPoints: number;
  processedPoints: number;
  nextPointIndex: number;
  chunkSize: number;
  startedAt: string;
  updatedAt: string;
  lastHeartbeatAt: string;
  minElevationM: number | null;
  maxElevationM: number | null;
  totalAscentM: number;
  totalDescentM: number;
  distanceM: number | null;
  priorElevationM: number | null;
  validCount: number;
  profileJson: string | null;
  errorMessage: string | null;
  /** Owner (PocketBase user id). Set for progress/cancel ownership. */
  userId: string | null;
  overallPercentComplete: number | null;
  currentPhase: string | null;
  currentPhasePercent: number | null;
  error: string | null;
  currentTrackIndex: number | null;
  totalTracks: number | null;
};

export type EnrichmentCheckpointRecord = EnrichmentCheckpoint & { id: string };

function toCheckpoint(rec: Record<string, unknown>): EnrichmentCheckpointRecord {
  return {
    id: String(rec.id ?? ""),
    jobId: String(rec.jobId ?? ""),
    recordId: String(rec.recordId ?? ""),
    status: (rec.status as EnrichmentJobStatus) ?? "pending",
    totalPoints: Number(rec.totalPoints) ?? 0,
    processedPoints: Number(rec.processedPoints) ?? 0,
    nextPointIndex: Number(rec.nextPointIndex) ?? 0,
    chunkSize: Number(rec.chunkSize) ?? 0,
    startedAt: String(rec.startedAt ?? ""),
    updatedAt: String(rec.updatedAt ?? ""),
    lastHeartbeatAt: String(rec.lastHeartbeatAt ?? ""),
    minElevationM: rec.minElevationM != null ? Number(rec.minElevationM) : null,
    maxElevationM: rec.maxElevationM != null ? Number(rec.maxElevationM) : null,
    totalAscentM: Number(rec.totalAscentM) ?? 0,
    totalDescentM: Number(rec.totalDescentM) ?? 0,
    distanceM: rec.distanceM != null ? Number(rec.distanceM) : null,
    priorElevationM: rec.priorElevationM != null ? Number(rec.priorElevationM) : null,
    validCount: Number(rec.validCount) ?? 0,
    profileJson: rec.profileJson != null ? String(rec.profileJson) : null,
    errorMessage: rec.errorMessage != null ? String(rec.errorMessage) : null,
    userId: rec.userId != null ? String(rec.userId) : null,
    overallPercentComplete: rec.overallPercentComplete != null ? Number(rec.overallPercentComplete) : null,
    currentPhase: rec.currentPhase != null ? String(rec.currentPhase) : null,
    currentPhasePercent: rec.currentPhasePercent != null ? Number(rec.currentPhasePercent) : null,
    error: rec.error != null ? String(rec.error) : null,
    currentTrackIndex: rec.currentTrackIndex != null ? Number(rec.currentTrackIndex) : null,
    totalTracks: rec.totalTracks != null ? Number(rec.totalTracks) : null,
  };
}

/**
 * Find the most recent checkpoint for the given GPX record (any status).
 * Used to check cancellation and to get jobId by recordId.
 */
export async function getCheckpointByRecordId(
  pb: PocketBase,
  recordId: string
): Promise<EnrichmentCheckpointRecord | null> {
  try {
    const list = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `recordId = "${recordId}"`,
      sort: "-updatedAt",
    });
    const item = list.items[0];
    if (!item) return null;
    return toCheckpoint(item as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Find a resumable checkpoint for the given GPX record.
 * Returns the most recently updated job that is running or resumable.
 */
export async function getResumableCheckpoint(
  pb: PocketBase,
  recordId: string
): Promise<EnrichmentCheckpointRecord | null> {
  try {
    const list = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `recordId = "${recordId}" && (status = "running" || status = "resumable")`,
      sort: "-updatedAt",
    });
    const item = list.items[0];
    if (!item) return null;
    return toCheckpoint(item as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** PocketBase date format: "YYYY-MM-DD HH:mm:ss.sss" (no Z). */
function pbDateString(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Create a new job record (fresh run). Caller supplies jobId (e.g. crypto.randomUUID()).
 * Sets userId for ownership; progress fields are written via updateJobProgress.
 */
export async function createCheckpointRecord(
  pb: PocketBase,
  data: {
    jobId: string;
    recordId: string;
    userId: string | null;
    totalPoints: number;
    chunkSize: number;
  }
): Promise<EnrichmentCheckpointRecord> {
  const now = pbDateString(new Date());
  const body: Record<string, unknown> = {
    recordId: data.recordId,
    jobId: data.jobId,
    status: "running",
    totalPoints: data.totalPoints,
    processedPoints: 0,
    nextPointIndex: 0,
    chunkSize: data.chunkSize,
    startedAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
    totalAscentM: 0,
    totalDescentM: 0,
    validCount: 0,
  };
  if (data.userId != null) body.userId = data.userId;
  const rec = await pb.collection(COLLECTION).create(body);
  return toCheckpoint(rec as Record<string, unknown>);
}

/**
 * Idempotent checkpoint update. Call every N chunks and/or on heartbeat.
 * When checkpointRecordId is provided, updates that record directly; otherwise looks up by jobId.
 */
export async function saveCheckpoint(
  pb: PocketBase,
  recordId: string,
  jobId: string,
  data: {
    totalPoints: number;
    processedPoints: number;
    nextPointIndex: number;
    minElevationM: number | null;
    maxElevationM: number | null;
    totalAscentM: number;
    totalDescentM: number;
    distanceM: number;
    priorElevationM: number | null;
    validCount: number;
    profileJson: string | null;
  },
  checkpointRecordId?: string | null
): Promise<void> {
  const now = pbDateString(new Date());
  let recordIdToUpdate: string;
  if (checkpointRecordId) {
    recordIdToUpdate = checkpointRecordId;
  } else {
    const list = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `jobId = "${jobId}"`,
    });
    const existing = list.items[0];
    if (!existing) {
      console.warn("[enrichment-checkpoint] No record found for update", { jobId, recordId });
      return;
    }
    recordIdToUpdate = (existing as { id: string }).id;
  }
  const body: Record<string, unknown> = {
    totalPoints: data.totalPoints,
    processedPoints: data.processedPoints,
    nextPointIndex: data.nextPointIndex,
    totalAscentM: data.totalAscentM,
    totalDescentM: data.totalDescentM,
    distanceM: data.distanceM,
    validCount: data.validCount,
    updatedAt: now,
    lastHeartbeatAt: now,
  };
  if (data.minElevationM != null) body.minElevationM = data.minElevationM;
  if (data.maxElevationM != null) body.maxElevationM = data.maxElevationM;
  if (data.priorElevationM != null) body.priorElevationM = data.priorElevationM;
  if (data.profileJson != null) body.profileJson = data.profileJson;
  await pb.collection(COLLECTION).update(recordIdToUpdate, body);
}

/**
 * Mark job as completed. Clears resumable state.
 */
export async function markCheckpointCompleted(
  pb: PocketBase,
  recordId: string,
  jobId: string
): Promise<void> {
  const list = await pb.collection(COLLECTION).getList(1, 1, {
    filter: `recordId = "${recordId}" && jobId = "${jobId}"`,
  });
  const existing = list.items[0];
  if (!existing) return;
  const now = pbDateString(new Date());
  await pb.collection(COLLECTION).update((existing as { id: string }).id, {
    status: "completed",
    updatedAt: now,
    lastHeartbeatAt: now,
  });
}

/**
 * Mark job as failed. Use resumable if we have a valid checkpoint to resume from.
 */
export async function markCheckpointFailed(
  pb: PocketBase,
  recordId: string,
  jobId: string,
  errorMessage: string,
  resumable: boolean
): Promise<void> {
  const list = await pb.collection(COLLECTION).getList(1, 1, {
    filter: `recordId = "${recordId}" && jobId = "${jobId}"`,
  });
  const existing = list.items[0];
  if (!existing) return;
  const now = pbDateString(new Date());
  await pb.collection(COLLECTION).update((existing as { id: string }).id, {
    status: resumable ? "resumable" : "failed",
    errorMessage,
    error: errorMessage,
    updatedAt: now,
    lastHeartbeatAt: now,
  });
}

/**
 * Mark the job for the given record as cancelled (e.g. GPX file was deleted).
 * Updates PocketBase so the running job can see cancellation from any process.
 */
export async function markCheckpointCancelled(
  pb: PocketBase,
  recordId: string
): Promise<boolean> {
  const cp = await getCheckpointByRecordId(pb, recordId);
  if (!cp || cp.status === "completed" || cp.status === "failed" || cp.status === "cancelled") {
    return false;
  }
  const now = pbDateString(new Date());
  await pb.collection(COLLECTION).update(cp.id, {
    status: "cancelled",
    updatedAt: now,
    lastHeartbeatAt: now,
  });
  return true;
}

/**
 * Get enrichment job by jobId. Used by progress API and for ownership checks.
 */
export async function getJobByJobId(
  pb: PocketBase,
  jobId: string
): Promise<EnrichmentCheckpointRecord | null> {
  try {
    const list = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `jobId = "${jobId}"`,
    });
    const item = list.items[0];
    if (!item) return null;
    return toCheckpoint(item as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Progress update payload for updateJobProgress. Only provided fields are written. */
export type JobProgressUpdate = {
  status?: EnrichmentJobStatus;
  overallPercentComplete?: number;
  currentPhase?: string;
  currentPhasePercent?: number;
  processedPoints?: number;
  totalPoints?: number;
  currentTrackIndex?: number;
  totalTracks?: number;
  error?: string;
};

/**
 * Write progress (and optionally status/error) to the enrichment_jobs record.
 * Call at a practical cadence (e.g. every 1–2 s or every N chunks), not on every point.
 * When checkpointRecordId is provided, updates that record; otherwise looks up by jobId.
 */
export async function updateJobProgress(
  pb: PocketBase,
  jobId: string,
  update: JobProgressUpdate,
  checkpointRecordId?: string | null
): Promise<void> {
  const now = pbDateString(new Date());
  let recordIdToUpdate: string;
  if (checkpointRecordId) {
    recordIdToUpdate = checkpointRecordId;
  } else {
    const list = await pb.collection(COLLECTION).getList(1, 1, {
      filter: `jobId = "${jobId}"`,
    });
    const existing = list.items[0];
    if (!existing) return;
    recordIdToUpdate = (existing as { id: string }).id;
  }
  const body: Record<string, unknown> = {
    updatedAt: now,
    lastHeartbeatAt: now,
  };
  if (update.status != null) body.status = update.status;
  if (update.overallPercentComplete != null) body.overallPercentComplete = update.overallPercentComplete;
  if (update.currentPhase != null) body.currentPhase = update.currentPhase;
  if (update.currentPhasePercent != null) body.currentPhasePercent = update.currentPhasePercent;
  if (update.processedPoints != null) body.processedPoints = update.processedPoints;
  if (update.totalPoints != null) body.totalPoints = update.totalPoints;
  if (update.currentTrackIndex != null) body.currentTrackIndex = update.currentTrackIndex;
  if (update.totalTracks != null) body.totalTracks = update.totalTracks;
  if (update.error != null) body.error = update.error;
  await pb.collection(COLLECTION).update(recordIdToUpdate, body);
}

/** Incomplete states: job is not finished and can be resumed after restart. */
const INCOMPLETE_STATUSES = ["running", "resumable"];

/**
 * List incomplete enrichment jobs (running or resumable). Optionally filter by userId.
 * Returns at most one job per recordId (most recent by updatedAt). Used for startup resume.
 */
export async function getIncompleteEnrichmentJobs(
  pb: PocketBase,
  userId?: string | null
): Promise<EnrichmentCheckpointRecord[]> {
  try {
    const filter =
      userId && userId.trim()
        ? `(status = "running" || status = "resumable") && userId = "${userId}"`
        : "status = \"running\" || status = \"resumable\"";
    const list = await pb.collection(COLLECTION).getList(1, 500, {
      filter,
      sort: "-updatedAt",
    });
    const seen = new Set<string>();
    const out: EnrichmentCheckpointRecord[] = [];
    for (const item of list.items) {
      const rec = toCheckpoint(item as Record<string, unknown>);
      if (rec.status === "cancelled" || rec.status === "completed" || rec.status === "failed") continue;
      if (seen.has(rec.recordId)) continue;
      seen.add(rec.recordId);
      out.push(rec);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Return one claimable job for the worker, or null. Claimable = running or resumable.
 * Caller must claim by calling updateJobProgress(..., { status: "running" }, job.id) then run the executor.
 * Only one worker process should run when using this (no Redis/lock).
 */
export async function getNextClaimableJob(
  pb: PocketBase
): Promise<EnrichmentCheckpointRecord | null> {
  const jobs = await getIncompleteEnrichmentJobs(pb);
  return jobs[0] ?? null;
}

/**
 * For the given record IDs, return map of recordId -> jobId for those that have an active (running/resumable) job.
 * Optionally filter by userId so only the current user's jobs are returned.
 */
export async function getActiveEnrichmentJobIdsForRecordIds(
  pb: PocketBase,
  recordIds: string[],
  userId?: string | null
): Promise<Record<string, string>> {
  if (recordIds.length === 0) return {};
  try {
    const idsFilter = recordIds.map((id) => `recordId = "${id}"`).join(" || ");
    const statusFilter = "status = \"running\" || status = \"resumable\"";
    const userFilter = userId && userId.trim() ? ` && userId = "${userId}"` : "";
    const list = await pb.collection(COLLECTION).getList(1, 500, {
      filter: `(${idsFilter}) && (${statusFilter})${userFilter}`,
      sort: "-updatedAt",
    });
    const out: Record<string, string> = {};
    for (const item of list.items) {
      const rec = toCheckpoint(item as Record<string, unknown>);
      if (!out[rec.recordId]) out[rec.recordId] = rec.jobId;
    }
    return out;
  } catch {
    return {};
  }
}
