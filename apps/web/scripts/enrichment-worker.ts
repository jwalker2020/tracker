#!/usr/bin/env node
/**
 * Enrichment worker entrypoint. Run outside the web process (e.g. separate Docker container).
 * Requires: NEXT_PUBLIC_PB_URL, and optionally DEM_BASE_PATH, DEM_MANIFEST_PATH.
 * Set DISABLE_WEB_ENRICHMENT_RESUME=true on the web app when using this worker.
 *
 * Run from apps/web: pnpm run enrichment-worker
 * Or: pnpm exec tsx scripts/enrichment-worker.ts
 */

import PocketBase from "pocketbase";
import { getPocketBaseUrl } from "../src/lib/pocketbase";
import { runWorkerLoop } from "../src/lib/enrichment/workerLoop";

function main(): void {
  let pb: PocketBase;
  try {
    const url = getPocketBaseUrl();
    pb = new PocketBase(url);
    pb.autoCancellation(false);
  } catch (e) {
    console.error(
      "Enrichment worker: missing or invalid NEXT_PUBLIC_PB_URL. Set it in the environment."
    );
    process.exit(1);
  }

  runWorkerLoop(pb).catch((err) => {
    console.error("Enrichment worker loop failed:", err);
    process.exit(1);
  });
}

main();
