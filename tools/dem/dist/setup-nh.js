/**
 * One-command New Hampshire DEM setup: discover URLs, download to folder, generate manifest.
 */
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { downloadAll } from "./download.js";
import { runGenerateManifest } from "./generate-manifest.js";
import { discoverUsgsNhDemUrls } from "./usgs-nh.js";
const DEFAULT_OUTPUT_DIR = "data/dem/nh";
/** When run via pnpm -C tools/dem, cwd is tools/dem; resolve repo root so default is repo/data/dem/nh. */
function getRepoRoot() {
    const cwd = process.cwd();
    const normalized = resolve(cwd);
    if (normalized.endsWith("tools/dem") || normalized.endsWith(join("tools", "dem"))) {
        return resolve(normalized, "..", "..");
    }
    return cwd;
}
/**
 * Create DEM folder, discover NH DEM URLs from USGS, download GeoTIFFs, generate manifest.json.
 * Uses existing download and manifest generation code.
 */
export async function runSetupNh(options = {}) {
    const log = options.log ?? console.log;
    const repoRoot = getRepoRoot();
    const outputDir = options.outputDir != null
        ? resolve(repoRoot, options.outputDir)
        : resolve(repoRoot, DEFAULT_OUTPUT_DIR);
    const force = options.force === true;
    log("New Hampshire DEM setup");
    log(`  output: ${outputDir}`);
    log(`  force: ${force}`);
    await mkdir(outputDir, { recursive: true });
    log("Discovering NH DEM URLs from USGS National Map...");
    const urls = await discoverUsgsNhDemUrls();
    if (urls.length === 0) {
        throw new Error("No DEM product URLs returned from USGS. Try again later or use --input urls.txt with dem:download.");
    }
    log(`Found ${urls.length} product URL(s).`);
    log("Downloading GeoTIFFs (stream to disk, skip existing)...");
    const result = await downloadAll(urls, outputDir, { concurrency: 3, force, retries: 3 }, log);
    const totalOk = result.downloaded + result.skipped;
    if (totalOk === 0 && result.failed > 0) {
        throw new Error(`All ${result.failed} download(s) failed. Check network or try --force.`);
    }
    if (result.errors.length > 0) {
        for (const e of result.errors)
            log(`  failed: ${e.url} - ${e.error}`);
    }
    const manifestPath = join(outputDir, "manifest.json");
    log("Generating manifest.json...");
    const { tileCount } = await runGenerateManifest({
        dir: outputDir,
        filterToNh: false,
        manifestPath,
        log,
    });
    return {
        outputDir,
        manifestPath,
        downloaded: result.downloaded,
        skipped: result.skipped,
        failed: result.failed,
        tileCount,
    };
}
