/**
 * Generate manifest.json for a folder of GeoTIFFs. Used by both manifest and download commands.
 */

import { join } from "node:path";
import { buildManifest } from "./build-manifest.js";
import { nativeBboxToWgs84 } from "./compute-wgs84-bbox.js";
import { readGeoTiffMetadata } from "./read-geotiff-metadata.js";
import {
  readFileAsBuffer,
  resolveTilePath,
  scanDemFolder,
} from "./scan-dem-folder.js";
import type { TileInput } from "./build-manifest.js";
import { writeManifest } from "./write-manifest.js";

export type GenerateManifestOptions = {
  dir: string;
  filterToNh: boolean;
  manifestPath?: string;
  log?: (msg: string) => void;
};

/**
 * Scan dir for GeoTIFFs, read metadata, write manifest.json. Throws on fatal errors.
 */
export async function runGenerateManifest(options: GenerateManifestOptions): Promise<{ tileCount: number }> {
  const { dir, filterToNh, manifestPath, log = console.log } = options;
  const outputPath = manifestPath ?? join(dir, "manifest.json");

  const files = await scanDemFolder(dir);
  if (files.length === 0) {
    throw new Error(`No GeoTIFF files (.tif/.tiff) found in ${dir}`);
  }
  log(`Found ${files.length} GeoTIFF(s)`);

  const tiles: TileInput[] = [];
  let failed = 0;
  for (const relPath of files) {
    const absPath = resolveTilePath(dir, relPath);
    try {
      const buffer = await readFileAsBuffer(absPath);
      const meta = await readGeoTiffMetadata(relPath, buffer);
      const bbox = nativeBboxToWgs84(meta.nativeBbox, meta.crs);
      tiles.push({
        path: relPath,
        bbox,
        crs: meta.crs,
        nodata: meta.nodata,
      });
      log(`  ok: ${relPath}`);
    } catch (err) {
      failed++;
      log(`  skip: ${relPath} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (tiles.length === 0) {
    throw new Error("No tiles could be read.");
  }
  if (failed) log(`Skipped ${failed} file(s) due to errors.`);

  const manifest = buildManifest(tiles, filterToNh);
  log(`Tiles in manifest: ${manifest.tiles.length}`);
  await writeManifest(outputPath, manifest);
  log(`Wrote ${outputPath}`);
  return { tileCount: manifest.tiles.length };
}
