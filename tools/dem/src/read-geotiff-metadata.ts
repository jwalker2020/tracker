/**
 * Read GeoTIFF metadata (bbox in native CRS, CRS, nodata) using geotiff.js.
 */

import { fromArrayBuffer } from "geotiff";
import geokeysToProj4 from "geotiff-geokeys-to-proj4";
import type { NativeBbox } from "./types.js";

const WGS84 = "EPSG:4326";

/** GeoKey IDs (GeoTIFF spec). */
const GeographicTypeGeoKey = 2048;
const ProjectedCSTypeGeoKey = 3072;

export type GeoTiffMeta = {
  /** Bounding box in file's native CRS: [minX, minY, maxX, maxY]. */
  nativeBbox: NativeBbox;
  /** CRS string for proj4 (e.g. "EPSG:32619" or proj4 def). */
  crs: string;
  /** Nodata value if present. */
  nodata?: number;
};

/**
 * Derive CRS string from GeoKeys. Prefer EPSG: code when available.
 */
function crsFromGeoKeys(geoKeys: Record<string, number> | undefined, proj4String: string): string {
  if (!geoKeys) return proj4String;
  const projected = geoKeys[ProjectedCSTypeGeoKey] ?? (geoKeys as Record<string, number>).ProjectedCSTypeGeoKey;
  if (projected != null && Number.isInteger(projected)) return `EPSG:${projected}`;
  const geographic = geoKeys[GeographicTypeGeoKey] ?? (geoKeys as Record<string, number>).GeographicTypeGeoKey;
  if (geographic != null && Number.isInteger(geographic)) return `EPSG:${geographic}`;
  return proj4String;
}

/**
 * Read metadata from a GeoTIFF file (first image only).
 * Uses geotiff.js and geotiff-geokeys-to-proj4 for CRS.
 */
export async function readGeoTiffMetadata(filePath: string, buffer: ArrayBuffer): Promise<GeoTiffMeta> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage(0);

  const nativeBbox = image.getBoundingBox() as NativeBbox;
  const geoKeys = image.getGeoKeys() as Record<string, number> | undefined;

  let crs = WGS84;
  let proj4String = "";
  if (geoKeys) {
    try {
      // geotiff-geokeys-to-proj4 expects its GeoKeys shape; geotiff.js returns a compatible object
      const projObj = geokeysToProj4.toProj4(geoKeys as unknown as Parameters<typeof geokeysToProj4.toProj4>[0]);
      proj4String = projObj?.proj4 ?? "";
      if (proj4String) crs = crsFromGeoKeys(geoKeys, proj4String);
    } catch {
      // fallback: if geographic type is 4326, bbox is already in lon/lat
      const gt = geoKeys[GeographicTypeGeoKey] ?? (geoKeys as Record<string, number>).GeographicTypeGeoKey;
      if (gt === 4326) crs = WGS84;
    }
  }

  let nodata: number | undefined;
  try {
    const gdalMeta = await image.getGDALMetadata?.();
    if (gdalMeta && typeof gdalMeta === "object" && "NODATA" in gdalMeta) {
      const v = (gdalMeta as Record<string, string>)["NODATA"];
      if (v != null) {
        const n = Number.parseFloat(String(v).trim());
        if (Number.isFinite(n)) nodata = n;
      }
    }
  } catch {
    // ignore
  }

  return { nativeBbox, crs, nodata };
}
