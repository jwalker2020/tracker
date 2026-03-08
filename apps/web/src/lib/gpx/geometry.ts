import type { Feature, LineString, MultiLineString } from "geojson";
import type { GpxTrack } from "./parse";
import { parseGpx } from "./parse";

/** Record shape needed for fetching display geometry (id, file, optional enrichedGeoJson). */
export type GpxRecordForGeometry = { id: string; file: string; enrichedGeoJson?: string };

export type DisplayGeometry = {
  tracks: GpxTrack[];
};

/**
 * Get display geometry for a GPX file record. Uses enrichedGeoJson when present and valid;
 * otherwise fetches the stored GPX file and parses it. Returns empty tracks on any error.
 * Single place for "how we get track coordinates for the map" to avoid duplicating parsing.
 */
export async function getDisplayGeometry(
  record: GpxRecordForGeometry,
  baseUrl: string
): Promise<DisplayGeometry> {
  if (record.enrichedGeoJson?.trim()) {
    try {
      const geojson = JSON.parse(record.enrichedGeoJson) as {
        type?: string;
        features?: Array<Feature<LineString | MultiLineString> & { properties?: { name?: string } }>;
      };
      if (geojson?.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
        return { tracks: [] };
      }
      const tracks: GpxTrack[] = [];
      let idx = 0;
      for (const f of geojson.features) {
        const g = f.geometry;
        if (!g) continue;
        const name = f.properties?.name ?? `Track ${++idx}`;
        if (g.type === "LineString") {
          const points = g.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
          if (points.length >= 2) tracks.push({ name, points });
        } else if (g.type === "MultiLineString") {
          g.coordinates.forEach((line, i) => {
            const points = line.map(([lng, lat]) => [lat, lng] as [number, number]);
            if (points.length >= 2)
              tracks.push({
                name: g.coordinates.length > 1 ? `${name} (part ${i + 1})` : name,
                points,
              });
          });
        }
      }
      return { tracks };
    } catch {
      return { tracks: [] };
    }
  }

  try {
    const url = `${baseUrl}/api/files/gpx_files/${record.id}/${record.file}`;
    const res = await fetch(url);
    if (!res.ok) return { tracks: [] };
    const gpxText = await res.text();
    const parsed = parseGpx(gpxText);
    return { tracks: parsed.tracks };
  } catch {
    return { tracks: [] };
  }
}
