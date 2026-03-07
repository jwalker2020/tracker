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
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let geotiffModule: any = null;

async function getGeotiff(): Promise<{ fromArrayBuffer: (buffer: ArrayBuffer) => Promise<{ getImage: (i?: number) => Promise<GeoTIFFImage> }> }> {
  if (!geotiffModule) geotiffModule = await import("geotiff");
  const mod = geotiffModule?.default ?? geotiffModule;
  return mod;
}

/**
 * Check if a value is nodata: NaN, ±Infinity, or equals the tile's nodata value.
 */
function isNoData(value: number, nodata: number | null): boolean {
  if (typeof value !== "number") return true;
  if (!Number.isFinite(value)) return true;
  if (nodata != null && value === nodata) return true;
  return false;
}

/**
 * Raster sampler for one DEM tile. Transforms WGS84 lon/lat to raster CRS via proj4,
 * then maps to pixel coordinates and samples. Caches the open GeoTIFF image.
 */
export class DemRasterSampler {
  private openTiles = new Map<string, OpenTile>();
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Open a tile and cache it. Idempotent for the same path.
   */
  async openTile(meta: DemTileMeta): Promise<OpenTile | null> {
    const path = await this.resolvePath(meta.path);
    const cached = this.openTiles.get(path);
    if (cached) return cached;

    const GeoTIFF = await getGeotiff();
    const fs = await import("node:fs/promises");
    const pathMod = await import("node:path");

    const fullPath = pathMod.isAbsolute(meta.path) ? meta.path : pathMod.join(this.basePath, meta.path);
    let buffer: ArrayBuffer;
    try {
      buffer = (await fs.readFile(fullPath)).buffer as ArrayBuffer;
    } catch {
      return null;
    }

    let geotiff: { getImage: (index?: number) => Promise<GeoTIFFImage> };
    try {
      const GeoTIFF = await getGeotiff();
      geotiff = await GeoTIFF.fromArrayBuffer(buffer);
    } catch {
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

    const open: OpenTile = {
      meta,
      image,
      origin,
      resolution,
      width,
      height,
      nodata,
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
    const { meta, origin, resolution, width, height, nodata } = tile;

    const toProjected = proj4(WGS84, meta.crs);
    const [x, y] = toProjected.forward([lonWgs84, latWgs84]);

    const pixelX = (x - origin[0]) / resolution[0];
    const pixelY = (origin[1] - y) / resolution[1];

    const ix = Math.floor(pixelX);
    const iy = Math.floor(pixelY);
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) {
      return { elevationM: null };
    }

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
