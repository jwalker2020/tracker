/**
 * Scan a folder for GeoTIFF files (.tif, .tiff).
 */
/**
 * List paths of GeoTIFF files in a directory (one level only).
 * Paths are relative to baseDir.
 */
export declare function scanDemFolder(baseDir: string): Promise<string[]>;
/**
 * Read file as ArrayBuffer for GeoTIFF parsing.
 */
export declare function readFileAsBuffer(absPath: string): Promise<ArrayBuffer>;
export declare function resolveTilePath(baseDir: string, relativePath: string): string;
