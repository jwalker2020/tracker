import { fromArrayBuffer } from "geotiff";
import proj4 from "proj4";
import type { DemTileMeta, ElevationSample } from "./types";

const WGS84 = "EPSG:4326";

type GeoTIFFImage = {
  getOrigin: () => number[];
  getResolution: () => number[];
  getWidth: () => number;
  getHeight: () => number;
  readRasters: (opts: {
    window?: [number, number, number, number];
    samples?: number[];
    interleave?: boolean;
  }) => Promise<{ [key: number]: Float32Array | Float64Array | Int16Array | Int32Array | Uint8Array }>;
};

type OpenTile = {
  meta: DemTileMeta;
  image: GeoTIFFImage;
  origin: [number, number];
  resolution: [number, number];
  width: number;
  height: number;
  nodata: number | null;
  /** Cached WGS84 → raster CRS transform to avoid repeated proj4() in hot path. */
  toProjected: (lonlat: [number, number]) => [number, number];
  /** Reused buffer for toProjected to avoid allocating [lon, lat] per sample. */
  scratchLonLat: [number, number];
};

/**
 * Check if a value is nodata: NaN, ±Infinity, or equals the tile's nodata value.
 */
function isNoData(value: number, nodata: number | null): boolean {
  if (typeof value !== "number") return true;
  if (!Number.isFinite(value)) return true;
  if (nodata != null && value === nodata) return true;
  return false;
}

/** Instrumentation: tile open and read counts. */
export type DemSamplerStats = {
  openTileHits: number;
  openTileMisses: number;
  readRasterCalls: number;
  /** Times samplePointsInTile used the split path (window exceeded MAX_BATCH_PIXELS). */
  oversizedBatchSplits: number;
  /** readRasters calls that were part of a split (sub-batches). */
  subBatchReads: number;
};

/**
 * Max tiles to keep open at once. Each tile holds a full GeoTIFF in memory (external/V8);
 * capping prevents OOM on large DEM coverages (e.g. 6+ large tiles ≈ 6GB+).
 */
const MAX_OPEN_TILES = 4;

/**
 * Raster sampler for one DEM tile. Transforms WGS84 lon/lat to raster CRS via proj4,
 * then maps to pixel coordinates and samples. Caches the open GeoTIFF image.
 */
export class DemRasterSampler {
  private openTiles = new Map<string, OpenTile>();
  private readErrorPaths = new Set<string>();
  private basePath: string;
  private stats: DemSamplerStats = {
    openTileHits: 0,
    openTileMisses: 0,
    readRasterCalls: 0,
    oversizedBatchSplits: 0,
    subBatchReads: 0,
  };

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  getStats(): DemSamplerStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      openTileHits: 0,
      openTileMisses: 0,
      readRasterCalls: 0,
      oversizedBatchSplits: 0,
      subBatchReads: 0,
    };
  }

  /**
   * Open a tile and cache it. Idempotent for the same path.
   * Keeps at most MAX_OPEN_TILES in memory (FIFO eviction) to bound external memory.
   */
  async openTile(meta: DemTileMeta): Promise<OpenTile | null> {
    const path = await this.resolvePath(meta.path);
    const cached = this.openTiles.get(path);
    if (cached) {
      this.stats.openTileHits++;
      return cached;
    }
    this.stats.openTileMisses++;

    while (this.openTiles.size >= MAX_OPEN_TILES) {
      const firstKey = this.openTiles.keys().next().value;
      if (firstKey == null) break;
      this.closeTile(firstKey);
    }

    const fs = await import("node:fs/promises");
    const pathMod = await import("node:path");

    const fullPath = pathMod.isAbsolute(meta.path) ? meta.path : pathMod.join(this.basePath, meta.path);
    let buffer: ArrayBuffer;
    try {
      const nodeBuffer = await fs.readFile(fullPath);
      buffer = nodeBuffer.buffer.slice(
        nodeBuffer.byteOffset,
        nodeBuffer.byteOffset + nodeBuffer.byteLength
      ) as ArrayBuffer;
    } catch (err) {
      console.warn("[DEM] Could not read tile file:", fullPath, err instanceof Error ? err.message : String(err));
      return null;
    }

    let geotiff: { getImage: (index?: number) => Promise<GeoTIFFImage> };
    try {
      geotiff = (await fromArrayBuffer(buffer)) as {
        getImage: (index?: number) => Promise<GeoTIFFImage>;
      };
    } catch (err) {
      console.warn("[DEM] Could not parse GeoTIFF:", fullPath, err instanceof Error ? err.message : String(err));
      return null;
    }

    const image = await geotiff.getImage(0);
    if (!image) return null;

    let origin: [number, number];
    let resolution: [number, number];
    try {
      const o = image.getOrigin();
      const r = image.getResolution();
      origin = [Number(o[0]), Number(o[1])];
      resolution = [Number(r[0]), Number(r[1])];
    } catch {
      return null;
    }

    const width = image.getWidth();
    const height = image.getHeight();
    const nodata = meta.nodata ?? null;
    const proj = proj4(WGS84, meta.crs);
    const toProjected = (lonlat: [number, number]) => proj.forward(lonlat);

    const open: OpenTile = {
      meta,
      image,
      origin,
      resolution,
      width,
      height,
      nodata,
      toProjected,
      scratchLonLat: [0, 0],
    };
    this.openTiles.set(path, open);
    return open;
  }

  private async resolvePath(relativePath: string): Promise<string> {
    const pathMod = await import("node:path");
    return pathMod.isAbsolute(relativePath)
      ? relativePath
      : pathMod.join(this.basePath, relativePath);
  }

  /**
   * Sample elevation at WGS84 (longitude, latitude). Returns null if out of extent or nodata.
   */
  async sample(tile: OpenTile, lonWgs84: number, latWgs84: number): Promise<ElevationSample> {
    const { origin, resolution, width, height, nodata, toProjected } = tile;

    const scratch = tile.scratchLonLat;
    const lonlat: [number, number] =
      scratch != null
        ? ((scratch[0] = lonWgs84), (scratch[1] = latWgs84), scratch)
        : [lonWgs84, latWgs84];
    const [x, y] = toProjected(lonlat);

    // resolution[1] is often negative (image Y increases downward); use abs so pixel Y increases southward
    const resX = resolution[0];
    const resY = Math.abs(resolution[1]);
    const pixelX = (x - origin[0]) / resX;
    const pixelY = (origin[1] - y) / resY;

    const ix = Math.floor(pixelX);
    const iy = Math.floor(pixelY);
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) {
      return { elevationM: null };
    }

    try {
      this.stats.readRasterCalls++;
      const window = [ix, iy, ix + 1, iy + 1] as [number, number, number, number];
      const rasters = await tile.image.readRasters({
        window,
        samples: [0],
        interleave: false,
      });
      const band = rasters[0];
      if (!band || band.length === 0) return { elevationM: null };
      const value = Number(band[0]);
      if (isNoData(value, nodata)) return { elevationM: null };
      return { elevationM: Number.isFinite(value) ? value : null };
    } catch (err) {
      // Some GeoTIFFs (e.g. compressed USGS) can trigger RangeError / buffer bounds in geotiff.js
      const path = tile.meta.path;
      if (!this.readErrorPaths.has(path)) {
        this.readErrorPaths.add(path);
        console.warn(
          "[DEM] Tile read error (treating as nodata):",
          path,
          err instanceof Error ? err.message : String(err)
        );
      }
      return { elevationM: null };
    }
  }

  /**
   * Max pixels in one readRasters window to avoid excessive memory (e.g. long track spanning full tile).
   * When exceeded, points are split into sub-windows of at most SUB_WINDOW_SIZE^2 pixels.
   */
  private static readonly MAX_BATCH_PIXELS = 4096 * 4096;
  /** Sub-window edge size in pixels when splitting an oversized batch. Each sub-window ≤ SUB_WINDOW_SIZE². */
  private static readonly SUB_WINDOW_SIZE = 2048;

  /**
   * Sample elevation for multiple points that lie in the same tile. One or more readRasters calls
   * (single window, or sub-windows if the full window would exceed MAX_BATCH_PIXELS).
   * Points outside the tile extent get null. Nodata values return null.
   */
  async samplePointsInTile(
    tile: OpenTile,
    lngs: number[],
    lats: number[]
  ): Promise<(number | null)[]> {
    const n = lngs.length;
    if (n !== lats.length) throw new Error("lngs and lats length mismatch");
    const result: (number | null)[] = new Array(n);
    const { origin, resolution, width, height, nodata, toProjected } = tile;
    const resX = resolution[0];
    const resY = Math.abs(resolution[1]);

    const pixelCoords: { ix: number; iy: number; idx: number }[] = [];
    for (let idx = 0; idx < n; idx++) {
      const [x, y] = toProjected([lngs[idx]!, lats[idx]!]);
      const pixelX = (x - origin[0]) / resX;
      const pixelY = (origin[1] - y) / resY;
      const ix = Math.floor(pixelX);
      const iy = Math.floor(pixelY);
      if (ix < 0 || ix >= width || iy < 0 || iy >= height) {
        result[idx] = null;
        continue;
      }
      pixelCoords.push({ ix, iy, idx });
    }

    if (pixelCoords.length === 0) return result;

    let minIx = pixelCoords[0]!.ix;
    let minIy = pixelCoords[0]!.iy;
    let maxIx = pixelCoords[0]!.ix;
    let maxIy = pixelCoords[0]!.iy;
    for (let k = 1; k < pixelCoords.length; k++) {
      const p = pixelCoords[k]!;
      if (p.ix < minIx) minIx = p.ix;
      if (p.iy < minIy) minIy = p.iy;
      if (p.ix > maxIx) maxIx = p.ix;
      if (p.iy > maxIy) maxIy = p.iy;
    }
    const w = maxIx - minIx + 1;
    const h = maxIy - minIy + 1;

    if (w * h > DemRasterSampler.MAX_BATCH_PIXELS) {
      this.stats.oversizedBatchSplits++;
      const subSize = DemRasterSampler.SUB_WINDOW_SIZE;
      const buckets = new Map<string, { ix: number; iy: number; idx: number }[]>();
      for (const p of pixelCoords) {
        const cx = Math.floor(p.ix / subSize);
        const cy = Math.floor(p.iy / subSize);
        const key = `${cx}_${cy}`;
        let list = buckets.get(key);
        if (!list) {
          list = [];
          buckets.set(key, list);
        }
        list.push(p);
      }
      for (const [, list] of buckets) {
        let bMinIx = list[0]!.ix;
        let bMinIy = list[0]!.iy;
        let bMaxIx = list[0]!.ix;
        let bMaxIy = list[0]!.iy;
        for (let k = 1; k < list.length; k++) {
          const p = list[k]!;
          if (p.ix < bMinIx) bMinIx = p.ix;
          if (p.iy < bMinIy) bMinIy = p.iy;
          if (p.ix > bMaxIx) bMaxIx = p.ix;
          if (p.iy > bMaxIy) bMaxIy = p.iy;
        }
        const bw = bMaxIx - bMinIx + 1;
        const bh = bMaxIy - bMinIy + 1;
        try {
          this.stats.readRasterCalls++;
          this.stats.subBatchReads++;
          const window = [bMinIx, bMinIy, bMaxIx + 1, bMaxIy + 1] as [number, number, number, number];
          const rasters = await tile.image.readRasters({
            window,
            samples: [0],
            interleave: false,
          });
          const band = rasters[0];
          if (!band || band.length === 0) {
            for (const p of list) result[p.idx] = null;
            continue;
          }
          for (const p of list) {
            const offset = (p.iy - bMinIy) * bw + (p.ix - bMinIx);
            const value = Number(band[offset]);
            if (isNoData(value, nodata)) {
              result[p.idx] = null;
            } else {
              result[p.idx] = Number.isFinite(value) ? value : null;
            }
          }
        } catch (err) {
          const path = tile.meta.path;
          if (!this.readErrorPaths.has(path)) {
            this.readErrorPaths.add(path);
            console.warn(
              "[DEM] Tile read error in sub-batch (treating as nodata):",
              path,
              err instanceof Error ? err.message : String(err)
            );
          }
          for (const p of list) result[p.idx] = null;
        }
      }
      return result;
    }

    try {
      this.stats.readRasterCalls++;
      const window = [minIx, minIy, maxIx + 1, maxIy + 1] as [number, number, number, number];
      const rasters = await tile.image.readRasters({
        window,
        samples: [0],
        interleave: false,
      });
      const band = rasters[0];
      if (!band || band.length === 0) {
        for (const p of pixelCoords) result[p.idx] = null;
        return result;
      }
      for (const p of pixelCoords) {
        const offset = (p.iy - minIy) * w + (p.ix - minIx);
        const value = Number(band[offset]);
        if (isNoData(value, nodata)) {
          result[p.idx] = null;
        } else {
          result[p.idx] = Number.isFinite(value) ? value : null;
        }
      }
    } catch (err) {
      const path = tile.meta.path;
      if (!this.readErrorPaths.has(path)) {
        this.readErrorPaths.add(path);
        console.warn(
          "[DEM] Tile read error in batch (treating as nodata):",
          path,
          err instanceof Error ? err.message : String(err)
        );
      }
      for (const p of pixelCoords) result[p.idx] = null;
    }
    return result;
  }

  /**
   * Close a tile and remove from cache (e.g. for cleanup).
   */
  closeTile(path: string): void {
    this.openTiles.delete(path);
  }

  closeAll(): void {
    this.openTiles.clear();
  }
}
