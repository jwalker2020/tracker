/**
 * Runs once per Node.js process when the Next.js server starts.
 * Resumes incomplete enrichment jobs so they survive server kill/restart.
 */

let startupResumeDone = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (startupResumeDone) return;
  startupResumeDone = true;

  void (async () => {
    try {
      const { default: pb } = await import("@/lib/pocketbase");
      const {
        getIncompleteEnrichmentJobs,
        updateJobProgress,
      } = await import("@/app/api/gpx/enrichment-checkpoint");
      const {
        runEnrichmentInBackground,
        startProgressLogging,
      } = await import("@/lib/enrichment/runEnrichment");

      const jobs = await getIncompleteEnrichmentJobs(pb);
      if (jobs.length === 0) return;
      console.warn(`[enrichment] Found ${jobs.length} resumable job(s) on startup.`);

      for (const job of jobs) {
        const { id: checkpointRecordId, recordId, jobId, status } = job;
        if (status === "completed" || status === "failed" || status === "cancelled") {
          console.warn(`[enrichment] Skipped already-terminated job ${jobId} for record ${recordId}.`);
          continue;
        }
        try {
          await updateJobProgress(pb, jobId, { status: "running" }, checkpointRecordId);
          console.warn(`[enrichment] Resuming job ${jobId} for record ${recordId}.`);
          startProgressLogging(jobId, checkpointRecordId, true);
          void runEnrichmentInBackground(recordId, jobId, checkpointRecordId);
        } catch (e) {
          console.warn(`[enrichment] Failed to resume job ${jobId}:`, e);
        }
      }
    } catch (e) {
      console.warn("[enrichment] Startup resume failed:", e);
    }
  })();
}
