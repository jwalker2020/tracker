/**
 * Write manifest.json to a path.
 */

import { writeFile } from "node:fs/promises";
import type { Manifest } from "./types.js";

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  const json = JSON.stringify(manifest, null, 2);
  await writeFile(path, json, "utf8");
}
