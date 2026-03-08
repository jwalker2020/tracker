"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { GpxFileRecordForDisplay } from "@/lib/gpx";
import { getDisplayGeometry } from "@/lib/gpx";
import { DEFAULT_BASEMAP_ID, getBasemapById } from "@/lib/maps/basemaps";
import {
  DEFAULT_OVERLAY_OPACITY,
  getHillshadeLayerById,
  type HillshadeMode,
} from "@/lib/maps/overlays";
import { getLatLngForIndex, TrackElevationProfile, type ProfilePoint } from "@/components/gpx/TrackElevationProfile";
import { TrackDetailsPanel } from "@/components/gpx/TrackDetailsPanel";
import { MapHoverMarker } from "@/components/maps/MapHoverMarker";
import {
  fetchParcelsInBounds,
  formatParcelPopupContent,
  NH_PARCELS_ATTRIBUTION,
  type ParcelAttributes,
} from "@/lib/maps/nh-parcels";

import "leaflet/dist/leaflet.css";

/** Initial map view: center of New Hampshire. */
const DEFAULT_CENTER: [number, number] = [43.9, -71.6];
const DEFAULT_ZOOM = 8;

/** Fallback tile url/attribution so TileLayer never receives undefined (avoids .length on undefined). */
const FALLBACK_TILE_URL =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const FALLBACK_ATTRIBUTION = "© OpenStreetMap contributors";

type MapViewProps = {
  baseUrl: string;
  files: GpxFileRecordForDisplay[];
  fitToSelectionTrigger?: number;
  className?: string;
  /** When provided with onBasemapIdChange, basemap is controlled by parent (picker rendered outside MapView). */
  basemapId?: string;
  onBasemapIdChange?: (id: string) => void;
  /** Which hillshade overlay to show: none | usgs | esri. Renders above basemap, below tracks. */
  hillshadeMode?: HillshadeMode;
  onHillshadeModeChange?: (mode: HillshadeMode) => void;
  /** When true, NH parcels overlay is shown above basemap/hillshade, below tracks. */
  parcelsEnabled?: boolean;
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
          hitPoly.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            setSelectedTrack({ fileId: rec.id, trackIndex });
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
    }
  }, [selectedTrack]);

  return null;
}

const PARCEL_STYLE = {
  color: "#94a3b8",
  weight: 1,
  fillColor: "#cbd5e1",
  fillOpacity: 0.15,
};

function ParcelOverlay({ enabled }: { enabled: boolean }) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);

  const loadParcels = useCallback(() => {
    if (!enabled) return;
    const b = map.getBounds();
    const bounds = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    let cancelled = false;
    fetchParcelsInBounds(bounds)
      .then((geojson) => {
        if (cancelled || !layerRef.current) return;
        layerRef.current.clearLayers();
        layerRef.current.addData(geojson as GeoJSON.FeatureCollection);
      })
      .catch(() => {
        if (!cancelled && layerRef.current) {
          layerRef.current.clearLayers();
        }
      });
  }, [map, enabled]);

  useEffect(() => {
    if (!enabled) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return;
    }
    const emptyGeoJSON: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const layer = L.geoJSON(emptyGeoJSON, {
        style: () => PARCEL_STYLE,
        onEachFeature(feature, layerInstance) {
          const attrs = feature.properties as ParcelAttributes | undefined;
          if (attrs) {
            layerInstance.bindPopup(formatParcelPopupContent(attrs), {
              maxWidth: 320,
              className: "parcel-popup",
            });
          }
        },
    }).addTo(map);
    layerRef.current = layer;
    map.attributionControl?.addAttribution(NH_PARCELS_ATTRIBUTION);
    loadParcels();
    return () => {
      map.attributionControl?.removeAttribution(NH_PARCELS_ATTRIBUTION);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onMoveEnd = () => loadParcels();
    map.on("moveend", onMoveEnd);
    return () => {
      map.off("moveend", onMoveEnd);
    };
  }, [map, enabled, loadParcels]);

  return null;
}

function parseProfileJson(json: string | null): ProfilePoint[] | null {
  if (!json || typeof json !== "string") return null;
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return null;
    const points = arr
      .filter(
        (p): p is Record<string, unknown> =>
          p != null && typeof p === "object" && "d" in p && "e" in p
      )
      .map((p) => {
        const d = Number((p as ProfilePoint).d);
        const e = Number((p as ProfilePoint).e);
        if (!Number.isFinite(d) || !Number.isFinite(e)) return null;
        const lat = typeof (p as ProfilePoint).lat === "number" ? (p as ProfilePoint).lat : undefined;
        const lng = typeof (p as ProfilePoint).lng === "number" ? (p as ProfilePoint).lng : undefined;
        return { d, e, lat, lng } as ProfilePoint;
      })
      .filter((p): p is ProfilePoint => p != null);
    return points.length >= 2 ? points : null;
  } catch {
    return null;
  }
}

export function MapView({
  baseUrl,
  files: filesProp,
  fitToSelectionTrigger = 0,
  className = "",
  basemapId: controlledBasemapId,
  onBasemapIdChange,
  hillshadeMode: controlledHillshadeMode,
  onHillshadeModeChange,
  parcelsEnabled = false,
}: MapViewProps) {
  const files = filesProp ?? [];
  const [internalBasemapId, setInternalBasemapId] = useState<string>(DEFAULT_BASEMAP_ID);
  const basemapId = controlledBasemapId ?? internalBasemapId;
  const setBasemapId = onBasemapIdChange ?? setInternalBasemapId;
  const [internalHillshadeMode, setInternalHillshadeMode] = useState<HillshadeMode>("none");
  const hillshadeMode = onHillshadeModeChange ? controlledHillshadeMode ?? "none" : internalHillshadeMode;
  const setHillshadeMode = onHillshadeModeChange ?? setInternalHillshadeMode;
  const hillshadeLayer = getHillshadeLayerById(hillshadeMode);
  const basemap =
    getBasemapById(basemapId) ??
    getBasemapById(DEFAULT_BASEMAP_ID) ?? {
      id: "osm",
      name: "OpenStreetMap",
      url: FALLBACK_TILE_URL,
      attribution: FALLBACK_ATTRIBUTION,
      maxZoom: 19,
      subdomains: "abc",
    };
  const baseTileUrl = typeof basemap?.url === "string" ? basemap.url : FALLBACK_TILE_URL;
  const stadiaKey =
    typeof process.env.NEXT_PUBLIC_STADIA_MAPS_API_KEY === "string" &&
    process.env.NEXT_PUBLIC_STADIA_MAPS_API_KEY.length > 0
      ? process.env.NEXT_PUBLIC_STADIA_MAPS_API_KEY
      : null;
  const tileUrl =
    stadiaKey && baseTileUrl.includes("stadiamaps.com")
      ? `${baseTileUrl}${baseTileUrl.includes("?") ? "&" : "?"}api_key=${stadiaKey}`
      : baseTileUrl;
  const tileAttribution = typeof basemap?.attribution === "string" ? basemap.attribution : FALLBACK_ATTRIBUTION;
  const [selectedTrack, setSelectedTrack] = useState<SelectedTrack | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedTrackPoints, setSelectedTrackPoints] = useState<[number, number][] | null>(null);

  useEffect(() => {
    setHoveredIndex(null);
    setSelectedTrackPoints(null);
  }, [selectedTrack]);

  useEffect(() => {
    if (!selectedTrack || !baseUrl) return;
    const file = files.find((f) => f.id === selectedTrack.fileId);
    if (!file) return;
    let cancelled = false;
    getDisplayGeometry(file, baseUrl).then(({ tracks }) => {
      if (cancelled) return;
      const track = tracks[selectedTrack.trackIndex];
      setSelectedTrackPoints(track?.points && track.points.length >= 2 ? track.points : null);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, files, selectedTrack]);

  const selectedProfile = useMemo(() => {
    if (!selectedTrack) return null;
    const file = files.find((f) => f.id === selectedTrack.fileId);
    const track = file?.enrichedTracks?.[selectedTrack.trackIndex];
    if (!track) return null;
    const profilePoints = parseProfileJson(track.elevationProfileJson);
    return { trackName: track.name, profilePoints, track };
  }, [files, selectedTrack]);

  const onHoverIndex = useCallback((index: number | null) => {
    setHoveredIndex((prev) => (index === prev ? prev : index));
  }, []);

  const hoveredLatLng = useMemo((): [number, number] | null => {
    if (hoveredIndex == null || !selectedProfile?.profilePoints) return null;
    return getLatLngForIndex(
      selectedProfile.profilePoints,
      selectedTrackPoints,
      hoveredIndex
    );
  }, [hoveredIndex, selectedProfile?.profilePoints, selectedTrackPoints]);

  return (
    <div className={`flex h-full w-full flex-col overflow-visible ${className}`}>
      <div className="relative min-h-0 flex-1">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          className="h-full w-full min-h-[300px] rounded-lg bg-slate-900"
          style={{ height: "100%", minHeight: 300 }}
        >
          <TileLayer
            key={basemap.id}
            url={tileUrl}
            attribution={tileAttribution}
            maxZoom={basemap.maxZoom}
            {...(basemap.subdomains != null ? { subdomains: basemap.subdomains } : {})}
          />
          {hillshadeLayer && (
            <TileLayer
              key={`hillshade-${hillshadeMode}`}
              url={hillshadeLayer.url}
              attribution={hillshadeLayer.attribution}
              opacity={hillshadeLayer.opacity ?? DEFAULT_OVERLAY_OPACITY}
              maxZoom={hillshadeLayer.maxZoom}
              zIndex={1}
            />
          )}
          {parcelsEnabled && <ParcelOverlay enabled={parcelsEnabled} />}
          {/* GpxOverlay and MapHoverMarker render above parcel layer so track click/hover work. */}
          <GpxOverlay
            baseUrl={baseUrl}
            files={files}
            selectedTrack={selectedTrack}
            setSelectedTrack={setSelectedTrack}
          />
          <MapHoverMarker hoveredLatLng={hoveredLatLng} />
          <FitToSelection files={files} fitToSelectionTrigger={fitToSelectionTrigger} />
        </MapContainer>
      </div>
      {selectedTrack && (
        <div className="flex h-[220px] shrink-0 gap-0 border-t border-slate-700 bg-slate-900/98 overflow-hidden">
          <div className="w-[280px] shrink-0 border-r border-slate-700 p-2 flex flex-col min-h-0">
            {selectedProfile ? (
              <TrackDetailsPanel
                trackName={selectedProfile.trackName}
                track={selectedProfile.track}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Track details not available.
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 p-2 flex flex-col">
            {selectedProfile ? (
              <TrackElevationProfile
                trackName={selectedProfile.trackName}
                profilePoints={selectedProfile.profilePoints}
                trackPoints={selectedTrackPoints}
                onHoverIndex={onHoverIndex}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Elevation profile not available for this track.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
