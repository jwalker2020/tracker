/**
 * Stream download DEM files with concurrency, retries with backoff, skip existing.
 */
export type DownloadOptions = {
    concurrency: number;
    force: boolean;
    retries: number;
    backoffMs: number;
};
export type DownloadResult = {
    downloaded: number;
    skipped: number;
    failed: number;
    errors: {
        url: string;
        error: string;
    }[];
};
/**
 * Download all URLs to outDir. Each file is named from the URL path. Streams to disk.
 */
export declare function downloadAll(urls: string[], outDir: string, options?: Partial<DownloadOptions>, log?: (msg: string) => void): Promise<DownloadResult>;
