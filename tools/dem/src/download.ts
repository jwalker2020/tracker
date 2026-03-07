/**
 * Stream download DEM files with concurrency, retries with backoff, skip existing.
 */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { existsSync } from "node:fs";

export type DownloadOptions = {
  concurrency: number;
  force: boolean;
  retries: number;
  backoffMs: number;
};

const DEFAULT_OPTIONS: DownloadOptions = {
  concurrency: 3,
  force: false,
  retries: 3,
  backoffMs: 1000,
};

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1] ?? "tile.tif";
    return last.includes(".") ? last : `${last}.tif`;
  } catch {
    return "tile.tif";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function streamToFile(response: Response, destPath: string): Promise<void> {
  if (response.body == null) throw new Error("No response body");
  const writable = createWriteStream(destPath, { flags: "w" });
  const nodeStream = Readable.fromWeb(
    response.body as Parameters<typeof Readable.fromWeb>[0]
  );
  await pipeline(nodeStream, writable);
}

async function downloadOne(
  url: string,
  destPath: string,
  opts: { force: boolean; retries: number; backoffMs: number },
  log: (msg: string) => void
): Promise<{ ok: true; skipped: boolean } | { ok: false; error: string }> {
  if (!opts.force && existsSync(destPath)) {
    log(`skip (exists): ${destPath}`);
    return { ok: true, skipped: true };
  }
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      if (attempt > 0) await sleep(opts.backoffMs * Math.pow(2, attempt - 1));
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      await mkdir(dirname(destPath), { recursive: true });
      await streamToFile(response, destPath);
      log(`downloaded: ${destPath}`);
      return { ok: true, skipped: false };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < opts.retries) log(`retry ${attempt + 1}/${opts.retries}: ${url}`);
    }
  }
  return { ok: false, error: lastErr?.message ?? "Unknown error" };
}

/**
 * Run at most `n` concurrent promises from an iterator of thunks.
 */
async function runWithConcurrency<T>(
  concurrency: number,
  items: T[],
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
}

export type DownloadResult = {
  downloaded: number;
  skipped: number;
  failed: number;
  errors: { url: string; error: string }[];
};

/**
 * Download all URLs to outDir. Each file is named from the URL path. Streams to disk.
 */
export async function downloadAll(
  urls: string[],
  outDir: string,
  options: Partial<DownloadOptions> = {},
  log: (msg: string) => void = console.log
): Promise<DownloadResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: { url: string; error: string }[] = [];
  let downloaded = 0;
  let skipped = 0;

  const tasks = urls.map((url) => ({
    url,
    destPath: join(outDir, filenameFromUrl(url)),
  }));

  await runWithConcurrency(opts.concurrency, tasks, async (t) => {
    const result = await downloadOne(t.url, t.destPath, opts, log);
    if (result.ok) {
      if (result.skipped) skipped++;
      else downloaded++;
    } else {
      errors.push({ url: t.url, error: result.error });
      log(`failed: ${t.url} - ${result.error}`);
    }
  });

  return {
    downloaded,
    skipped,
    failed: errors.length,
    errors,
  };
}
