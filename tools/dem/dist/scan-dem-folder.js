/**
 * Scan a folder for GeoTIFF files (.tif, .tiff).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const GEOTIFF_EXT = [".tif", ".tiff"];
function isGeoTiff(name) {
    const lower = name.toLowerCase();
    return GEOTIFF_EXT.some((ext) => lower.endsWith(ext));
}
/**
 * List paths of GeoTIFF files in a directory (one level only).
 * Paths are relative to baseDir.
 */
export async function scanDemFolder(baseDir) {
    const entries = await readdir(baseDir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
        if (e.isFile() && isGeoTiff(e.name))
            files.push(e.name);
    }
    return files.sort();
}
/**
 * Read file as ArrayBuffer for GeoTIFF parsing.
 */
export async function readFileAsBuffer(absPath) {
    const buf = await readFile(absPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
export function resolveTilePath(baseDir, relativePath) {
    return join(baseDir, relativePath);
}
