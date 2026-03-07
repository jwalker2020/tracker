/**
 * Stream download DEM files with concurrency, retries with backoff, skip existing.
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { existsSync } from "node:fs";
const DEFAULT_OPTIONS = {
    concurrency: 3,
    force: false,
    retries: 3,
    backoffMs: 1000,
};
function filenameFromUrl(url) {
    try {
        const u = new URL(url);
        const segs = u.pathname.split("/").filter(Boolean);
        const last = segs[segs.length - 1] ?? "tile.tif";
        return last.includes(".") ? last : `${last}.tif`;
    }
    catch {
        return "tile.tif";
    }
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function streamToFile(response, destPath) {
    if (response.body == null)
        throw new Error("No response body");
    const writable = createWriteStream(destPath, { flags: "w" });
    const nodeStream = Readable.fromWeb(response.body);
    await pipeline(nodeStream, writable);
}
async function downloadOne(url, destPath, opts, log) {
    if (!opts.force && existsSync(destPath)) {
        log(`skip (exists): ${destPath}`);
        return { ok: true, skipped: true };
    }
    let lastErr = null;
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
        try {
            if (attempt > 0)
                await sleep(opts.backoffMs * Math.pow(2, attempt - 1));
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
        }
        catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            if (attempt < opts.retries)
                log(`retry ${attempt + 1}/${opts.retries}: ${url}`);
        }
    }
    return { ok: false, error: lastErr?.message ?? "Unknown error" };
}
/**
 * Run at most `n` concurrent promises from an iterator of thunks.
 */
async function runWithConcurrency(concurrency, items, fn) {
    let index = 0;
    async function worker() {
        while (index < items.length) {
            const i = index++;
            await fn(items[i]);
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
}
/**
 * Download all URLs to outDir. Each file is named from the URL path. Streams to disk.
 */
export async function downloadAll(urls, outDir, options = {}, log = console.log) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const errors = [];
    let downloaded = 0;
    let skipped = 0;
    const tasks = urls.map((url) => ({
        url,
        destPath: join(outDir, filenameFromUrl(url)),
    }));
    await runWithConcurrency(opts.concurrency, tasks, async (t) => {
        const result = await downloadOne(t.url, t.destPath, opts, log);
        if (result.ok) {
            if (result.skipped)
                skipped++;
            else
                downloaded++;
        }
        else {
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
