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

    const init = async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      LRef.current = L;

      if (!containerRef.current) return;
      const map = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM) as LeafletMap;
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
      setReady(true);
    };
    init();
    return () => {
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

    const allBounds: import("leaflet").LatLngBounds[] = [];

    files.forEach((rec) => {
      const url = `${baseUrl}/api/files/gpx_files/${rec.id}/${rec.file}`;
      const color = rec.color || "#3b82f6";

      fetch(url)
        .then((r) => r.text())
        .then((gpxText) => {
          const { tracks } = parseGpx(gpxText);
          tracks.forEach((points) => {
            if (points.length < 2) return;
            const latlngs = points.map(([lat, lng]) => L.latLng(lat, lng));
            const poly = L.polyline(latlngs, { color, weight: 3 });
            layersRef.current?.addLayer(poly);
            allBounds.push(L.latLngBounds(latlngs));
          });
          if (allBounds.length > 0 && mapRef.current) {
            const union = allBounds[0].clone();
            allBounds.slice(1).forEach((b) => union.extend(b));
            mapRef.current.fitBounds(union, { padding: [24, 24], maxZoom: 14 });
          }
        })
        .catch(() => {});
    });

    if (files.length === 0 && mapRef.current) {
      mapRef.current.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, [ready, baseUrl, files]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={containerRef} className="h-full w-full min-h-[300px] rounded-lg bg-slate-900" />
      <div className="absolute right-2 top-2 flex flex-col gap-1 rounded border border-slate-700 bg-slate-900/95 p-1 shadow">
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
