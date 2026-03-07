/**
 * Load DEM GeoTIFF URLs from urls.txt (one per line) or urls.json (array or { urls: string[] }).
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";

const UrlsJsonSchema = z.union([
  z.array(z.string().url()),
  z.object({ urls: z.array(z.string().url()) }),
]);

/**
 * Load URLs from a file. Supports:
 * - .txt: one URL per line (blank lines and # comments ignored)
 * - .json: array of URL strings or { urls: string[] }
 */
export async function loadUrls(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) {
    const data = JSON.parse(raw) as unknown;
    const parsed = UrlsJsonSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid urls.json: ${parsed.error.message}`);
    return Array.isArray(parsed.data) ? parsed.data : parsed.data.urls;
  }

  if (lower.endsWith(".txt")) {
    const lines = raw.split(/\r?\n/);
    const urls: string[] = [];
    for (const line of lines) {
      const s = line.replace(/#.*$/, "").trim();
      if (s) {
        try {
          new URL(s);
          urls.push(s);
        } catch {
          throw new Error(`Invalid URL in urls.txt: ${s}`);
        }
      }
    }
    return urls;
  }

  throw new Error("Input file must be urls.txt or urls.json");
}
