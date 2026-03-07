#!/usr/bin/env node
/**
 * CLI: manifest = generate manifest.json for a DEM folder.
 *       download = download DEM GeoTIFFs from URLs then generate manifest.
 * Usage:
 *   pnpm manifest -- --input /path/to/dem [--state nh] [--output manifest.json]
 *   pnpm download -- --output /path/to/dir [--input urls.txt] [--source usgs-nh] [--concurrency 3] [--force] [--retries 3] [--no-manifest]
 */
import { join } from "node:path";
import { z } from "zod";
import { downloadAll } from "./download.js";
import { runGenerateManifest } from "./generate-manifest.js";
import { loadUrls } from "./load-urls.js";
import { runSetupNh } from "./setup-nh.js";
import { discoverUsgsNhDemUrls } from "./usgs-nh.js";
const ManifestArgsSchema = z.object({
    input: z.string().min(1, "input path is required"),
    state: z.enum(["nh", "NH"]).optional(),
    output: z.string().optional(),
});
const DownloadArgsSchema = z
    .object({
    output: z.string().min(1, "output directory is required"),
    input: z.string().optional(),
    source: z.enum(["usgs-nh"]).optional(),
    concurrency: z.coerce.number().int().min(1).max(20).optional(),
    force: z.boolean().optional(),
    retries: z.coerce.number().int().min(0).max(10).optional(),
    noManifest: z.boolean().optional(),
})
    .refine((a) => a.input != null || a.source === "usgs-nh", {
    message: "Either --input <file> or --source usgs-nh is required",
});
function parseArgv(argv) {
    const obj = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--input" && argv[i + 1]) {
            obj.input = argv[i + 1];
            i++;
        }
        else if (argv[i] === "--output" && argv[i + 1]) {
            obj.output = argv[i + 1];
            i++;
        }
        else if (argv[i] === "--state" && argv[i + 1]) {
            obj.state = argv[i + 1];
            i++;
        }
        else if (argv[i] === "--source" && argv[i + 1]) {
            obj.source = argv[i + 1];
            i++;
        }
        else if (argv[i] === "--concurrency" && argv[i + 1]) {
            obj.concurrency = argv[i + 1];
            i++;
        }
        else if (argv[i] === "--force") {
            obj.force = true;
        }
        else if (argv[i] === "--retries" && argv[i + 1]) {
            obj.retries = argv[i + 1];
            i++;
        }
        else if (argv[i] === "--no-manifest") {
            obj.noManifest = true;
        }
    }
    return obj;
}
function parseSetupNhArgv(argv) {
    let outputDir;
    let force = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--output" && argv[i + 1]) {
            outputDir = argv[i + 1];
            i++;
        }
        else if (argv[i] === "--force") {
            force = true;
        }
    }
    return { outputDir, force };
}
async function runManifest(argv) {
    const raw = parseArgv(argv);
    const args = ManifestArgsSchema.parse(raw);
    const inputDir = args.input;
    const filterToNh = args.state?.toLowerCase() === "nh";
    const outputPath = args.output ?? join(inputDir, "manifest.json");
    console.log("DEM manifest generator");
    console.log("  input:", inputDir);
    console.log("  filter to NH:", filterToNh);
    console.log("  output:", outputPath);
    try {
        await runGenerateManifest({
            dir: inputDir,
            filterToNh,
            manifestPath: outputPath,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ENOENT") || msg.includes("no such file")) {
            console.error("Input directory does not exist:", inputDir);
        }
        else {
            console.error(msg);
        }
        process.exitCode = 1;
    }
}
async function runDownload(argv) {
    const raw = parseArgv(argv);
    let args;
    try {
        args = DownloadArgsSchema.parse(raw);
    }
    catch (err) {
        console.error("download requires --output <dir> and either --input <file> or --source usgs-nh");
        console.error("  --output <dir>     output directory (required)");
        console.error("  --input <file>     urls.txt or urls.json");
        console.error("  --source usgs-nh    discover NH DEM URLs from USGS");
        console.error("  --concurrency N     default 3");
        console.error("  --force            re-download existing files");
        console.error("  --retries N        default 3");
        console.error("  --no-manifest      skip manifest generation");
        process.exitCode = 1;
        return;
    }
    const outDir = args.output;
    const source = args.source;
    const noManifest = args.noManifest === true;
    let urls;
    if (source === "usgs-nh") {
        console.log("Discovering New Hampshire DEM URLs from USGS National Map...");
        try {
            urls = await discoverUsgsNhDemUrls();
            console.log(`Found ${urls.length} product URL(s).`);
        }
        catch (err) {
            console.error("Discovery failed:", err instanceof Error ? err.message : String(err));
            process.exitCode = 1;
            return;
        }
        if (urls.length === 0) {
            console.warn("No DEM URLs returned. Try --input urls.txt with a manual URL list.");
            process.exitCode = 1;
            return;
        }
    }
    else {
        const inputFile = args.input;
        if (!inputFile) {
            console.error("Either --input urls.txt|urls.json or --source usgs-nh is required.");
            process.exitCode = 1;
            return;
        }
        try {
            urls = await loadUrls(inputFile);
        }
        catch (err) {
            console.error("Load URLs failed:", err instanceof Error ? err.message : String(err));
            process.exitCode = 1;
            return;
        }
        if (urls.length === 0) {
            console.warn("No URLs in file:", inputFile);
            process.exitCode = 1;
            return;
        }
        console.log(`Loaded ${urls.length} URL(s) from ${inputFile}.`);
    }
    const concurrency = args.concurrency ?? 3;
    const force = args.force === true;
    const retries = args.retries ?? 3;
    console.log("DEM download");
    console.log("  output:", outDir);
    console.log("  concurrency:", concurrency);
    console.log("  force:", force);
    console.log("  retries:", retries);
    const result = await downloadAll(urls, outDir, { concurrency, force, retries }, console.log);
    console.log(`Done: ${result.downloaded} downloaded, ${result.skipped} skipped, ${result.failed} failed.`);
    if (result.errors.length > 0) {
        for (const e of result.errors)
            console.error(`  ${e.url}: ${e.error}`);
    }
    if (noManifest) {
        console.log("Skipping manifest generation (--no-manifest).");
        return;
    }
    const totalOk = result.downloaded + result.skipped;
    if (totalOk === 0) {
        console.warn("No files downloaded; skipping manifest.");
        return;
    }
    console.log("Generating manifest.json...");
    try {
        await runGenerateManifest({
            dir: outDir,
            filterToNh: false,
            manifestPath: join(outDir, "manifest.json"),
        });
    }
    catch (err) {
        console.error("Manifest generation failed:", err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
async function runSetupNhCmd(argv) {
    const { outputDir, force } = parseSetupNhArgv(argv);
    try {
        const result = await runSetupNh({ outputDir, force });
        console.log("");
        console.log("--- DEM setup complete ---");
        console.log("Output directory:  ", result.outputDir);
        console.log("Files downloaded:   ", result.downloaded);
        console.log("Files skipped:      ", result.skipped);
        if (result.failed > 0)
            console.log("Downloads failed:   ", result.failed);
        console.log("Manifest path:      ", result.manifestPath);
        console.log("Tiles in manifest:  ", result.tileCount);
        console.log("");
        console.log("Next step: set the server env var (use the absolute path below).");
        console.log("");
        console.log("  DEM_BASE_PATH=" + result.outputDir);
        console.log("");
        console.log("Add to apps/web/.env.local:");
        console.log("");
        console.log("  DEM_BASE_PATH=" + result.outputDir);
        console.log("");
        console.log("Then start the app:  pnpm dev");
        console.log("");
    }
    catch (err) {
        console.error("Setup failed:", err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
async function main() {
    const argv = process.argv.slice(2);
    const sub = argv[0];
    const rest = argv.slice(1);
    if (sub === "setup-nh") {
        await runSetupNhCmd(rest);
        return;
    }
    if (sub === "download") {
        await runDownload(rest);
        return;
    }
    if (sub === "manifest") {
        await runManifest(rest);
        return;
    }
    console.error("Usage: dem-prep setup-nh | manifest | download [options]");
    console.error("  setup-nh [--output ./data/dem/nh] [--force]   one-command NH DEM setup");
    console.error("  manifest --input /path/to/dem [--state nh] [--output path]");
    console.error("  download --output /path/to/dir (--input urls.txt | --source usgs-nh) [--concurrency N] [--force] [--retries N] [--no-manifest]");
    process.exitCode = 1;
}
main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
