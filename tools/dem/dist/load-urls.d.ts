/**
 * Load DEM GeoTIFF URLs from urls.txt (one per line) or urls.json (array or { urls: string[] }).
 */
/**
 * Load URLs from a file. Supports:
 * - .txt: one URL per line (blank lines and # comments ignored)
 * - .json: array of URL strings or { urls: string[] }
 */
export declare function loadUrls(filePath: string): Promise<string[]>;
