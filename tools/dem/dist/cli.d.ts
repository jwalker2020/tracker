#!/usr/bin/env node
/**
 * CLI: manifest = generate manifest.json for a DEM folder.
 *       download = download DEM GeoTIFFs from URLs then generate manifest.
 * Usage:
 *   pnpm manifest -- --input /path/to/dem [--state nh] [--output manifest.json]
 *   pnpm download -- --output /path/to/dir [--input urls.txt] [--source usgs-nh] [--concurrency 3] [--force] [--retries 3] [--no-manifest]
 */
export {};
