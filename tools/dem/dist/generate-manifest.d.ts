/**
 * Generate manifest.json for a folder of GeoTIFFs. Used by both manifest and download commands.
 */
export type GenerateManifestOptions = {
    dir: string;
    filterToNh: boolean;
    manifestPath?: string;
    log?: (msg: string) => void;
};
/**
 * Scan dir for GeoTIFFs, read metadata, write manifest.json. Throws on fatal errors.
 */
export declare function runGenerateManifest(options: GenerateManifestOptions): Promise<{
    tileCount: number;
}>;
