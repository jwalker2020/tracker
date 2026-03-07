/**
 * Write manifest.json to a path.
 */
import type { Manifest } from "./types.js";
export declare function writeManifest(path: string, manifest: Manifest): Promise<void>;
