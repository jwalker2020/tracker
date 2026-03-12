/**
 * Runs once per Node.js process when the Next.js server starts.
 * Enrichment jobs are run by the separate worker process; the web app does not resume them.
 */

let startupResumeDone = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (startupResumeDone) return;
  startupResumeDone = true;
}
