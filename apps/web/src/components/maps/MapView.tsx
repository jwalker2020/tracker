"use client";

import { useEffect, useRef, useState } from "react";
import type { GpxFileRecord } from "@/lib/gpx-files";
import { parseGpx } from "@/lib/gpx-parse";

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795];
const DEFAULT_ZOOM = 4;

type MapViewProps = {
  baseUrl: string;
  files: GpxFileRecord[];
  className?: string;
};

type LeafletMap = import("leaflet").Map & { setBase?: (w: "osm" | "usgs") => void };
type LeafletLayerGroup = import("leaflet").LayerGroup;

export function MapView({ baseUrl, files, className = "" }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LeafletLayerGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const [basemap, setBasemap] = useState<"osm" | "usgs">("osm");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    // Remove any existing map so the container can be reused (e.g. React Strict Mode double-mount)
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      layersRef.current = null;
      LRef.current = null;
    }

    let cancelled = false;
    const init = async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !containerRef.current) return;
      LRef.current = L;

      if (!containerRef.current) return;
      // Remove map from a previous init (e.g. Strict Mode left container initialized)
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layersRef.current = null;
      }
      const map = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM) as LeafletMap;
      if (cancelled) {
        map.remove();
        return;
      }
      mapRef.current = map;

      const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      });
      const usgs = L.tileLayer(
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
        { attribution: "USGS" }
      );

      osm.addTo(map);
      const overlay = L.layerGroup().addTo(map);
      layersRef.current = overlay;

      const setBase = (which: "osm" | "usgs") => {
        map.removeLayer(osm);
        map.removeLayer(usgs);
        if (which === "osm") osm.addTo(map);
        else usgs.addTo(map);
      };
      map.setBase = setBase;
      if (!cancelled) setReady(true);
    };
    init();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
      LRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.setBase) map.setBase(basemap);
  }, [basemap]);

  useEffect(() => {
    if (!ready || !mapRef.current || !layersRef.current || !LRef.current) return;
    const L = LRef.current;
    layersRef.current.clearLayers();

    if (files.length === 0) return;

    // Draw tracks in list order: first file at bottom (back), last file on top (front)
    let cancelled = false;
    (async () => {
      for (const rec of files) {
        if (cancelled || !layersRef.current) return;
        const url = `${baseUrl}/api/files/gpx_files/${rec.id}/${rec.file}`;
        const color = rec.color || "#3b82f6";
        try {
          const res = await fetch(url);
          const gpxText = await res.text();
          if (cancelled || !layersRef.current) return;
          const { tracks } = parseGpx(gpxText);
          for (const points of tracks) {
            if (points.length < 2) continue;
            const latlngs = points.map(([lat, lng]) => L.latLng(lat, lng));
            const poly = L.polyline(latlngs, { color, weight: 3 });
            layersRef.current?.addLayer(poly);
          }
        } catch {
          // skip failed fetch
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, baseUrl, files]);

  return (
    <div className={`relative h-full w-full overflow-visible ${className}`}>
      <div ref={containerRef} className="h-full w-full min-h-[300px] rounded-lg bg-slate-900" />
      <div className="absolute left-2 bottom-12 z-[1000] flex flex-col gap-1 rounded border border-slate-700 bg-slate-900/95 p-1.5 shadow">
        <button
          type="button"
          onClick={() => setBasemap("osm")}
          className={`rounded px-2 py-1 text-xs font-medium ${basemap === "osm" ? "bg-sky-600 text-white" : "bg-slate-700 text-slate-200 hover:bg-slate-600"}`}
        >
          OpenStreetMap
        </button>
        <button
          type="button"
          onClick={() => setBasemap("usgs")}
          className={`rounded px-2 py-1 text-xs font-medium ${basemap === "usgs" ? "bg-sky-600 text-white" : "bg-slate-700 text-slate-200 hover:bg-slate-600"}`}
        >
          USGS Topo
        </button>
      </div>
    </div>
  );
}
