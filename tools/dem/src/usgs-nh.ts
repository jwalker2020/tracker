/**
 * Discover New Hampshire DEM GeoTIFF URLs from USGS National Map (TNM) API.
 */

import { NH_BBOX } from "./nh-boundary.js";

const TNM_PRODUCTS = "https://tnmaccess.nationalmap.gov/api/v1/products";

type TmProduct = {
  downloadURL?: string;
  url?: string;
  [key: string]: unknown;
};

/**
 * Fetch DEM product URLs for New Hampshire from TNM API.
 * Uses 1/3 arc-second NED dataset and GeoTIFF format.
 */
export async function discoverUsgsNhDemUrls(): Promise<string[]> {
  const [west, south, east, north] = NH_BBOX;
  const bbox = `${west},${south},${east},${north}`;
  const params = new URLSearchParams({
    bbox,
    datasets: "National Elevation Dataset (NED) 1/3 arc-second",
    prodFormats: "GeoTIFF",
    outputFormat: "JSON",
  });
  const url = `${TNM_PRODUCTS}?${params.toString()}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`TNM API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { items?: TmProduct[]; results?: TmProduct[] };
  const items = data.items ?? data.results ?? (Array.isArray(data) ? data : []);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const link = item.downloadURL ?? item.url;
    if (typeof link === "string" && link.length > 0) {
      const norm = link.trim();
      if (norm.toLowerCase().endsWith(".tif") || norm.toLowerCase().endsWith(".tiff")) {
        if (!seen.has(norm)) {
          seen.add(norm);
          urls.push(norm);
        }
      }
    }
  }
  return urls;
}
