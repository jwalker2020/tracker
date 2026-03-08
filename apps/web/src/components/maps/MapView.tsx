"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { GpxFileRecordForDisplay } from "@/lib/gpx";
import { getDisplayGeometry } from "@/lib/gpx";

import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795];
const DEFAULT_ZOOM = 4;
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const USGS_URL =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}";

type MapViewProps = {
  baseUrl: string;
  files: GpxFileRecordForDisplay[];
  fitToSelectionTrigger?: number;
  className?: string;
};

type LeafletPolyline = import("leaflet").Polyline;
type SelectedTrack = { fileId: string; trackIndex: number };

const VISIBLE_WEIGHT = 3;
const SELECTED_WEIGHT = 6;

type TrackLayerRef = {
  poly: LeafletPolyline;
  hitPoly: LeafletPolyline;
  fileId: string;
  trackIndex: number;
  name: string;
};

function parseBoundsJson(boundsJson: string): L.LatLngBounds | null {
  try {
    const b = JSON.parse(boundsJson) as { south?: number; west?: number; north?: number; east?: number };
    if (
      typeof b.south !== "number" ||
      typeof b.west !== "number" ||
      typeof b.north !== "number" ||
      typeof b.east !== "number"
    )
      return null;
    return L.latLngBounds(
      [b.south, b.west],
      [b.north, b.east]
    );
  } catch {
    return null;
  }
}

function FitToSelection({
  files,
  fitToSelectionTrigger,
}: {
  files: GpxFileRecordForDisplay[];
  fitToSelectionTrigger: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (fitToSelectionTrigger === 0 || files.length === 0) return;
    const boundsList: L.LatLngBounds[] = [];
    for (const f of files) {
      const b = parseBoundsJson(f.boundsJson);
      if (b) boundsList.push(b);
    }
    if (boundsList.length === 0) return;
    const combined = boundsList[0]!;
    for (let i = 1; i < boundsList.length; i++) {
      combined.extend(boundsList[i]!);
    }
    map.fitBounds(combined, { padding: [24, 24], maxZoom: 16 });
  }, [map, files, fitToSelectionTrigger]);
  return null;
}

function GpxOverlay({
  baseUrl,
  files,
  selectedTrack,
  setSelectedTrack,
}: {
  baseUrl: string;
  files: GpxFileRecordForDisplay[];
  selectedTrack: SelectedTrack | null;
  setSelectedTrack: (v: SelectedTrack | null) => void;
}) {
  const map = useMap();
  const layersRef = useRef<ReturnType<typeof import("leaflet").layerGroup> | null>(null);
  const trackLayersRef = useRef<TrackLayerRef[]>([]);

  useEffect(() => {
    if (!layersRef.current) {
      const overlay = L.layerGroup().addTo(map);
      layersRef.current = overlay;
    }
    const overlay = layersRef.current;
    overlay.clearLayers();
    trackLayersRef.current = [];

    const onMapClick = () => setSelectedTrack(null);
    map.on("click", onMapClick);

    if (files.length === 0) {
      return () => map.off("click", onMapClick);
    }

    let cancelled = false;
    (async () => {
      for (const rec of files) {
        if (cancelled || !overlay) return;
        const color = rec.color || "#3b82f6";
        const { tracks } = await getDisplayGeometry(rec, baseUrl);
        if (cancelled || !overlay) return;
        tracks.forEach((track, trackIndex) => {
          if (track.points.length < 2) return;
          const latlngs = track.points.map(([lat, lng]) => L.latLng(lat, lng));
          const poly = L.polyline(latlngs, { color, weight: VISIBLE_WEIGHT });
          const hitPoly = L.polyline(latlngs, {
            color,
            weight: VISIBLE_WEIGHT * 2,
            opacity: 0,
            interactive: true,
          });
          hitPoly.bindPopup(track.name);
          hitPoly.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            setSelectedTrack({ fileId: rec.id, trackIndex });
            hitPoly.openPopup();
          });
          overlay.addLayer(poly);
          overlay.addLayer(hitPoly);
          trackLayersRef.current.push({
            poly,
            hitPoly,
            fileId: rec.id,
            trackIndex,
            name: track.name,
          });
        });
      }
    })();
    return () => {
      cancelled = true;
      map.off("click", onMapClick);
    };
  }, [map, baseUrl, files, setSelectedTrack]);

  useEffect(() => {
    for (const ref of trackLayersRef.current) {
      const isSelected =
        selectedTrack?.fileId === ref.fileId && selectedTrack?.trackIndex === ref.trackIndex;
      const visibleWeight = isSelected ? SELECTED_WEIGHT : VISIBLE_WEIGHT;
      ref.poly.setStyle({ weight: visibleWeight });
      ref.hitPoly.setStyle({ weight: visibleWeight * 2 });
      if (isSelected) ref.hitPoly.openPopup();
      else ref.hitPoly.closePopup();
    }
  }, [selectedTrack]);

  return null;
}

export function MapView({
  baseUrl,
  files,
  fitToSelectionTrigger = 0,
  className = "",
}: MapViewProps) {
  const [basemap, setBasemap] = useState<"osm" | "usgs">("osm");
  const [selectedTrack, setSelectedTrack] = useState<SelectedTrack | null>(null);

  return (
    <div className={`relative h-full w-full overflow-visible ${className}`}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="h-full w-full min-h-[300px] rounded-lg bg-slate-900"
        style={{ height: "100%", minHeight: 300 }}
      >
        <TileLayer
          key={basemap}
          url={basemap === "osm" ? OSM_URL : USGS_URL}
          attribution={basemap === "osm" ? "© OpenStreetMap contributors" : "USGS"}
        />
        <GpxOverlay
          baseUrl={baseUrl}
          files={files}
          selectedTrack={selectedTrack}
          setSelectedTrack={setSelectedTrack}
        />
        <FitToSelection files={files} fitToSelectionTrigger={fitToSelectionTrigger} />
      </MapContainer>
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
