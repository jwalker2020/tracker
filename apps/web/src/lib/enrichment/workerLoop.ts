/**
 * Worker loop: poll for claimable enrichment jobs, claim one, run the shared executor, repeat.
 * Intended for a separate process/container; not tied to the Next.js request lifecycle.
 * By default the web app does not run jobs; only the worker does.
 * Progress, cancel, and delete-during-enrichment are handled entirely by runEnrichmentJob.
 */

import type PocketBase from "pocketbase";
import {
  getJobByJobId,
  getNextClaimableJob,
  updateJobProgress,
} from "@/app/api/gpx/enrichment-checkpoint";
import { demLog, runEnrichmentJob } from "./runEnrichmentJob";

const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Terminal statuses: do not run the executor. */
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number]);
}

export type WorkerLoopOptions = {
  /** Sleep duration when no job is available. Default 5000. */
  pollIntervalMs?: number;
};

/**
 * Run the enrichment worker loop: poll for a claimable job, claim it only if still runnable,
 * execute via runEnrichmentJob (which owns progress/cancel/delete handling), repeat.
 * Processes one job at a time. Never returns.
 */
export async function runWorkerLoop(
  pb: PocketBase,
  options: WorkerLoopOptions = {}
): Promise<never> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const intervalFromEnv = process.env.ENRICHMENT_WORKER_POLL_INTERVAL_MS;
  const resolvedPollMs = intervalFromEnv
    ? Math.max(1000, parseInt(intervalFromEnv, 10) || pollIntervalMs)
    : pollIntervalMs;

  demLog("Enrichment worker loop started.");

  while (true) {
    const job = await getNextClaimableJob(pb);
    if (!job) {
      await sleep(resolvedPollMs);
      continue;
    }

    const { id: checkpointRecordId, jobId, recordId } = job;

    const beforeClaim = await getJobByJobId(pb, jobId);
    if (!beforeClaim || isTerminal(beforeClaim.status)) {
      continue;
    }

    await updateJobProgress(pb, jobId, { status: "running" }, checkpointRecordId);

    const afterClaim = await getJobByJobId(pb, jobId);
    if (afterClaim && afterClaim.status === "cancelled") {
      continue;
    }

    try {
      demLog(`Worker claimed job ${jobId} (record ${recordId}), running executor.`);
      await runEnrichmentJob(pb, jobId);
    } catch (err) {
      demLog(
        `Worker job ${jobId} threw: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
