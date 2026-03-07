/**
 * Write manifest.json to a path.
 */
import { writeFile } from "node:fs/promises";
export async function writeManifest(path, manifest) {
    const json = JSON.stringify(manifest, null, 2);
    await writeFile(path, json, "utf8");
}
