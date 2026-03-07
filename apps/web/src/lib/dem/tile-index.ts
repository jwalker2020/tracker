import type { DemTileIndex, DemTileMeta, Wgs84Bbox } from "./types";

export type DemTileIndexConfig = {
  /** Path to folder containing DEM GeoTIFFs (and optionally manifest.json). */
  demBasePath: string;
  /**
   * If set, path to a manifest JSON file (relative to demBasePath or absolute).
   * Manifest format: { "tiles": DemTileMeta[] } with each tile.path relative to demBasePath.
   */
  manifestPath?: string;
};

const DEFAULT_MANIFEST = "manifest.json";

/**
 * Load tile index from a manifest file.
 * Manifest JSON: { "tiles": [ { "path": "tile1.tif", "bbox": [w,s,e,n], "crs": "EPSG:32610", "nodata": -9999? } ] }
 * Paths in tiles are relative to the directory containing the manifest (or demBasePath).
 */
export async function loadTileIndexFromManifest(
  demBasePath: string,
  manifestPath: string = DEFAULT_MANIFEST
): Promise<DemTileIndex> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");

  const manifestFullPath = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(demBasePath, manifestPath);

  const raw = await fs.readFile(manifestFullPath, "utf-8");
  const data = JSON.parse(raw) as { tiles?: unknown[] };

  if (!Array.isArray(data.tiles)) {
    throw new Error("DEM manifest must have a 'tiles' array");
  }

  const tiles: DemTileMeta[] = [];
  for (const t of data.tiles) {
    if (!isTileMeta(t)) continue;
    const bbox = normalizeBbox(t.bbox);
    const path = normalizeTilePath(t.path);
    tiles.push({
      path,
      bbox,
      crs: String(t.crs ?? "EPSG:4326"),
      nodata: t.nodata != null ? Number(t.nodata) : undefined,
    });
  }

  return { tiles, basePath: demBasePath };
}

/** If path is a URL, use the filename only so we can find the file under demBasePath. */
function normalizeTilePath(p: string): string {
  const s = p.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      const segs = new URL(s).pathname.split("/").filter(Boolean);
      return segs[segs.length - 1] ?? s;
    } catch {
      return s;
    }
  }
  return s;
}

function isTileMeta(t: unknown): t is Record<string, unknown> & { path: string; bbox: unknown; crs?: string } {
  return (
    typeof t === "object" &&
    t !== null &&
    "path" in t &&
    typeof (t as Record<string, unknown>).path === "string" &&
    "bbox" in t
  );
}

function normalizeBbox(bbox: unknown): Wgs84Bbox {
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const [w, s, e, n] = bbox as number[];
    return [Number(w), Number(s), Number(e), Number(n)];
  }
  if (bbox && typeof bbox === "object" && "west" in bbox && "south" in bbox && "east" in bbox && "north" in bbox) {
    const o = bbox as { west: number; south: number; east: number; north: number };
    return [o.west, o.south, o.east, o.north];
  }
  throw new Error("Tile bbox must be [west, south, east, north] or { west, south, east, north }");
}

/**
 * Build tile index from config: loads manifest if present, otherwise returns empty index.
 */
export async function loadTileIndex(config: DemTileIndexConfig): Promise<DemTileIndex> {
  const manifestPath = config.manifestPath ?? DEFAULT_MANIFEST;
  return loadTileIndexFromManifest(config.demBasePath, manifestPath);
}
