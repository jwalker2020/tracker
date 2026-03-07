/**
 * One-command New Hampshire DEM setup: discover URLs, download to folder, generate manifest.
 */
export type SetupNhOptions = {
    /** Output directory for DEM files and manifest.json. Default: repo root ./data/dem/nh. */
    outputDir?: string;
    /** Re-download files that already exist. */
    force?: boolean;
    log?: (msg: string) => void;
};
export type SetupNhResult = {
    outputDir: string;
    manifestPath: string;
    downloaded: number;
    skipped: number;
    failed: number;
    tileCount: number;
};
/**
 * Create DEM folder, discover NH DEM URLs from USGS, download GeoTIFFs, generate manifest.json.
 * Uses existing download and manifest generation code.
 */
export declare function runSetupNh(options?: SetupNhOptions): Promise<SetupNhResult>;
