/**
 * Discover New Hampshire DEM GeoTIFF URLs from USGS National Map (TNM) API.
 */
/**
 * Fetch DEM product URLs for New Hampshire from TNM API.
 * Uses 1/3 arc-second NED dataset and GeoTIFF format.
 */
export declare function discoverUsgsNhDemUrls(): Promise<string[]>;
