"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { EnrichedTrackSummaryForDisplay, GpxFileRecordForDisplay } from "@/lib/gpx";
import { getDisplayGeometry, parseEnrichedTrackSliceToDisplay } from "@/lib/gpx";
import { DEFAULT_BASEMAP_ID, getBasemapById } from "@/lib/maps/basemaps";
import {
  DEFAULT_OVERLAY_OPACITY,
  getHillshadeLayerById,
  type HillshadeMode,
} from "@/lib/maps/overlays";
import { getLatLngForIndex, type ProfilePoint } from "@/components/gpx/TrackElevationProfile";
import { TrackProfilePanel } from "@/components/gpx/TrackProfilePanel";
import { TrackDetailsPanel } from "@/components/gpx/TrackDetailsPanel";
import { MapHoverMarker } from "@/components/maps/MapHoverMarker";
import {
  fetchParcelsInBounds,
  formatParcelPopupContent,
  NH_PARCELS_ATTRIBUTION,
  type ParcelAttributes,
} from "@/lib/maps/nh-parcels";
import { fetchCamaByParcelOid } from "@/lib/maps/nh-parcel-details";

import "leaflet/dist/leaflet.css";

/** Initial map view: center of New Hampshire. */
const DEFAULT_CENTER: [number, number] = [43.9, -71.6];
const DEFAULT_ZOOM = 8;

/** Fallback tile url/attribution so TileLayer never receives undefined (avoids .length on undefined). */
const FALLBACK_TILE_URL =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const FALLBACK_ATTRIBUTION = "© OpenStreetMap contributors";

type MapViewProps = {
  files: GpxFileRecordForDisplay[];
  /** When provided, only tracks whose key (fileId-trackIndex) is in this set are shown. Omit or null = show all. */
  visibleTrackKeys?: Set<string> | null;
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

/** Height in px of the bottom chart panel when a track is selected; fit bounds leaves this as padding so tracks fit in the visible map. */
const BOTTOM_PANEL_HEIGHT_PX = 320;

/** Default max zoom for fitBounds when basemap max is not available (e.g. USGS 16). */
const DEFAULT_FIT_MAX_ZOOM = 19;

function FitToSelection({
  files,
  visibleTrackKeys,
  fitToSelectionTrigger,
  bottomPaddingPx = 0,
  maxZoom = DEFAULT_FIT_MAX_ZOOM,
}: {
  files: GpxFileRecordForDisplay[];
  /** When set, fit to bounds of these tracks only (so large files zoom to visible tracks, not whole file). */
  visibleTrackKeys?: Set<string> | null;
  fitToSelectionTrigger: number;
  /** When > 0, fitBounds uses this as bottom padding so bounds fit in the visible map above the panel. */
  bottomPaddingPx?: number;
  /** Cap zoom when fitting; should match tile layer (e.g. basemap.maxZoom) so tiles remain available. */
  maxZoom?: number;
}) {
  const map = useMap();
  const filesRef = useRef(files);
  filesRef.current = files;
  const visibleTrackKeysRef = useRef(visibleTrackKeys);
  visibleTrackKeysRef.current = visibleTrackKeys;
  useEffect(() => {
    if (fitToSelectionTrigger === 0) return;
    const currentFiles = filesRef.current;
    const visible = visibleTrackKeysRef.current;
    if (currentFiles.length === 0) return;
    const boundsList: L.LatLngBounds[] = [];
    let usedVisibleTracks = false;
    // Prefer bounds of visible tracks only so large files zoom to what's on screen, not the whole file.
    if (visible != null && visible.size > 0) {
      for (const f of currentFiles) {
        const tracks = f.enrichedTracks;
        if (!tracks?.length) {
          const b = parseBoundsJson(f.boundsJson);
          if (b) boundsList.push(b);
          continue;
        }
        for (let i = 0; i < tracks.length; i++) {
          const key = `${f.id}-${i}`;
          if (!visible.has(key)) continue;
          const t = tracks[i];
          const b = t?.bounds;
          if (
            b &&
            typeof b.south === "number" &&
            typeof b.west === "number" &&
            typeof b.north === "number" &&
            typeof b.east === "number"
          ) {
            boundsList.push(L.latLngBounds([b.south, b.west], [b.north, b.east]));
            usedVisibleTracks = true;
          }
        }
      }
    }
    if (boundsList.length === 0) {
      for (const f of currentFiles) {
        const b = parseBoundsJson(f.boundsJson);
        if (b) boundsList.push(b);
      }
    }
    if (boundsList.length === 0) return;
    const first = boundsList[0]!;
    const combined = L.latLngBounds(first.getSouthWest(), first.getNorthEast());
    for (let i = 1; i < boundsList.length; i++) {
      combined.extend(boundsList[i]!);
    }
    // Slightly shrink bounds toward center so fitBounds zooms in a bit (less margin, between no zoom and +1 level).
    const shrink = 0.9;
    const south = combined.getSouth();
    const north = combined.getNorth();
    const west = combined.getWest();
    const east = combined.getEast();
    const cLat = (south + north) / 2;
    const cLng = (west + east) / 2;
    const halfLat = ((north - south) / 2) * shrink;
    const halfLng = ((east - west) / 2) * shrink;
    const boundsToFit = L.latLngBounds(
      [cLat - halfLat, cLng - halfLng],
      [cLat + halfLat, cLng + halfLng]
    );
    const sw = boundsToFit.getSouthWest();
    const ne = boundsToFit.getNorthEast();
    const container = map.getContainer();
    const rect = container?.getBoundingClientRect?.();
    const padding = 4;
    console.info("[FitToSelection] zoom-to-selection", {
      path: usedVisibleTracks ? "visible-tracks" : "file-bounds",
      visibleSize: visible?.size ?? null,
      filesCount: currentFiles.length,
      boundsCount: boundsList.length,
      combined: { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng },
      padding,
      bottomPaddingPx,
      maxZoom,
      mapSize: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : null,
    });
    const fitOptions: L.FitBoundsOptions = {
      maxZoom,
      ...(bottomPaddingPx > 0
        ? {
            paddingTopLeft: L.point(padding, padding),
            paddingBottomRight: L.point(padding, bottomPaddingPx),
          }
        : { padding: L.point(padding, padding) }),
    };
    map.fitBounds(boundsToFit, fitOptions);
    // Only run on explicit "Zoom to selection" (fitToSelectionTrigger), not when visibleTrackKeys
    // changes (e.g. grade/curviness filter slider), so moving sliders doesn't zoom the map.
  }, [map, fitToSelectionTrigger, bottomPaddingPx, maxZoom]);
  return null;
}

function boundsFromSegment(
  profilePoints: ProfilePoint[],
  trackPoints: [number, number][] | null,
  minD: number,
  maxD: number
): L.LatLngBounds | null {
  const points: L.LatLng[] = [];
  for (let i = 0; i < profilePoints.length; i++) {
    const p = profilePoints[i];
    const d = p?.d;
    if (d == null || !Number.isFinite(d) || d < minD || d > maxD) continue;
    let lat: number;
    let lng: number;
    if (p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      lat = p.lat;
      lng = p.lng;
    } else if (trackPoints && trackPoints.length >= 2) {
      const ll = getLatLngForIndex(profilePoints, trackPoints, i);
      if (!ll) continue;
      [lat, lng] = ll;
    } else {
      continue;
    }
    points.push(L.latLng(lat, lng));
  }
  if (points.length === 0) return null;
  const bounds = L.latLngBounds(points);
  return bounds.isValid() ? bounds : null;
}

function FitToSelectedTrack({
  files,
  selectedTrack,
  chartDistanceRange,
  profilePoints,
  trackPoints,
  bottomPaddingPx = 0,
  maxZoom = DEFAULT_FIT_MAX_ZOOM,
  ignoreMapSyncRef,
  skipFitForMapSyncRef,
}: {
  files: GpxFileRecordForDisplay[];
  selectedTrack: SelectedTrack | null;
  /** When set, fit map to this distance segment instead of full track. */
  chartDistanceRange: { minD: number; maxD: number } | null;
  profilePoints: ProfilePoint[] | null;
  trackPoints: [number, number][] | null;
  bottomPaddingPx?: number;
  /** Cap zoom when fitting; should match tile layer (e.g. basemap.maxZoom). */
  maxZoom?: number;
  /** When set, MapToChartSync will skip updating range after we call fitBounds (avoids loop). */
  ignoreMapSyncRef?: { current: boolean };
  /** When set, skip fitBounds this run (range was updated from map zoom/pan, not chart drag). */
  skipFitForMapSyncRef?: { current: boolean };
}) {
  const map = useMap();
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    if (!selectedTrack) return;
    if (skipFitForMapSyncRef?.current) {
      skipFitForMapSyncRef.current = false;
      return;
    }
    let bounds: L.LatLngBounds | null = null;
    if (
      chartDistanceRange &&
      profilePoints &&
      profilePoints.length >= 2 &&
      (profilePoints.some((p) => p.lat != null && p.lng != null) || (trackPoints && trackPoints.length >= 2))
    ) {
      bounds = boundsFromSegment(
        profilePoints,
        trackPoints,
        chartDistanceRange.minD,
        chartDistanceRange.maxD
      );
    }
    if (!bounds) {
      const currentFiles = filesRef.current;
      const file = currentFiles.find((f) => f.id === selectedTrack.fileId);
      const track = file?.enrichedTracks?.[selectedTrack.trackIndex];
      const b = track?.bounds;
      if (
        !b ||
        typeof b.south !== "number" ||
        typeof b.west !== "number" ||
        typeof b.north !== "number" ||
        typeof b.east !== "number"
      )
        return;
      bounds = L.latLngBounds(
        [b.south, b.west],
        [b.north, b.east]
      );
    }
    // Small padding so the selected track fills the visible map area tightly; 24 was too loose.
    const padding = 12;
    const fitOptions: L.FitBoundsOptions = {
      maxZoom,
      ...(bottomPaddingPx > 0
        ? {
            paddingTopLeft: L.point(padding, padding),
            paddingBottomRight: L.point(padding, bottomPaddingPx),
          }
        : { padding: L.point(padding, padding) }),
    };
    let onMoveEnd: (() => void) | undefined;
    if (ignoreMapSyncRef) {
      ignoreMapSyncRef.current = true;
      onMoveEnd = () => {
        ignoreMapSyncRef.current = false;
        map.off("moveend", onMoveEnd!);
      };
      map.on("moveend", onMoveEnd);
    }
    map.fitBounds(bounds, fitOptions);
    return () => {
      if (onMoveEnd) map.off("moveend", onMoveEnd);
      if (ignoreMapSyncRef) ignoreMapSyncRef.current = false;
    };
  }, [map, selectedTrack, chartDistanceRange, profilePoints, trackPoints, bottomPaddingPx, maxZoom, ignoreMapSyncRef, skipFitForMapSyncRef]);
  return null;
}

/** Meters per pixel at zoom 0 at equator (Web Mercator). */
const METERS_PER_PIXEL_ZOOM0 = 156543.03392;
const METERS_TO_MILES = 1 / 1609.344;

/** Epsilon for comparing distance range (miles) to avoid redundant state updates. */
const RANGE_EPSILON_MI = 0.0001;

/**
 * When the user clears the selected track (e.g. clicks the map), the bottom panel unmounts and the
 * map container grows. Leaflet caches container size and does not observe DOM resize; we must call
 * invalidateSize() so the map recalculates and redraws to the new size (avoids a gray bar where
 * the panel was). Only runs on the transition from "selection set" to "selection cleared", not on
 * initial mount or when setting a selection.
 */
function MapResizeOnSelectionClear({ selectedTrack }: { selectedTrack: SelectedTrack | null }) {
  const map = useMap();
  const hadSelectionRef = useRef(false);
  useEffect(() => {
    const hadSelection = hadSelectionRef.current;
    hadSelectionRef.current = selectedTrack != null;
    if (hadSelection && selectedTrack == null) {
      // Defer until after React commit and layout so the map container has its new height.
      const id = requestAnimationFrame(() => {
        map.invalidateSize();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [map, selectedTrack]);
  return null;
}

/**
 * Syncs map viewport with chart range: reports minimum chart span (so chart can't zoom past map)
 * and visible distance range when the user pans/zooms the map. Skips updates when ignoreRef is true
 * (e.g. right after we programmatically fitBounds) to avoid update loops.
 */
function MapToChartSync({
  maxZoom,
  profilePoints,
  trackPoints,
  currentChartRange,
  onMinSpanMiles,
  onVisibleRangeChange,
  ignoreMapSyncRef,
  skipFitForMapSyncRef,
}: {
  maxZoom: number;
  profilePoints: ProfilePoint[] | null;
  trackPoints: [number, number][] | null;
  /** Current chart range so we can skip updating when visible range is effectively the same. */
  currentChartRange: { minD: number; maxD: number } | null;
  onMinSpanMiles: (miles: number) => void;
  onVisibleRangeChange: (range: { minD: number; maxD: number } | null) => void;
  ignoreMapSyncRef?: { current: boolean };
  /** Set to true before onVisibleRangeChange so FitToSelectedTrack skips fitBounds (avoid overriding user zoom/pan). */
  skipFitForMapSyncRef?: { current: boolean };
}) {
  const map = useMap();
  const profilePointsRef = useRef(profilePoints);
  const trackPointsRef = useRef(trackPoints);
  const currentChartRangeRef = useRef(currentChartRange);
  const onMinSpanMilesRef = useRef(onMinSpanMiles);
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
  profilePointsRef.current = profilePoints;
  trackPointsRef.current = trackPoints;
  currentChartRangeRef.current = currentChartRange;
  onMinSpanMilesRef.current = onMinSpanMiles;
  onVisibleRangeChangeRef.current = onVisibleRangeChange;

  useEffect(() => {
    if (maxZoom < 0 || !profilePoints?.length) return;
    const updateMinSpan = () => {
      const size = map.getSize();
      if (!size || size.x <= 0 || size.y <= 0) return;
      const center = map.getCenter();
      const latRad = (center.lat * Math.PI) / 180;
      const metersPerPixel =
        (METERS_PER_PIXEL_ZOOM0 * Math.cos(latRad)) / Math.pow(2, maxZoom);
      const minDimensionPx = Math.min(size.x, size.y);
      const minSpanMeters = minDimensionPx * metersPerPixel;
      const minSpanMiles = minSpanMeters * METERS_TO_MILES;
      onMinSpanMilesRef.current(minSpanMiles);
    };
    updateMinSpan();
    map.on("resize", updateMinSpan);
    return () => {
      map.off("resize", updateMinSpan);
    };
  }, [map, maxZoom, profilePoints?.length]);

  useEffect(() => {
    if (!profilePoints?.length) return;
    const updateVisibleRange = () => {
      if (ignoreMapSyncRef?.current) return;
      const pts = profilePointsRef.current;
      const trackPts = trackPointsRef.current;
      if (!pts?.length) return;
      const bounds = map.getBounds();
      let minD = Infinity;
      let maxD = -Infinity;
      let anyInView = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const d = p?.d;
        if (d == null || !Number.isFinite(d)) continue;
        let lat: number;
        let lng: number;
        if (p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          lat = p.lat;
          lng = p.lng;
        } else if (trackPts && trackPts.length >= 2) {
          const ll = getLatLngForIndex(pts, trackPts, i);
          if (!ll) continue;
          [lat, lng] = ll;
        } else continue;
        if (bounds.contains([lat, lng])) {
          anyInView = true;
          if (d < minD) minD = d;
          if (d > maxD) maxD = d;
        }
      }
      if (anyInView && Number.isFinite(minD) && Number.isFinite(maxD)) {
        const cur = currentChartRangeRef.current;
        if (
          cur &&
          Math.abs(cur.minD - minD) < RANGE_EPSILON_MI &&
          Math.abs(cur.maxD - maxD) < RANGE_EPSILON_MI
        ) {
          return;
        }
        if (skipFitForMapSyncRef) skipFitForMapSyncRef.current = true;
        onVisibleRangeChangeRef.current({ minD, maxD });
      }
    };
    map.on("moveend", updateVisibleRange);
    map.on("zoomend", updateVisibleRange);
    return () => {
      map.off("moveend", updateVisibleRange);
      map.off("zoomend", updateVisibleRange);
    };
  }, [map, profilePoints?.length, ignoreMapSyncRef, skipFitForMapSyncRef]);

  return null;
}

function GpxOverlay({
  files,
  visibleTrackKeys,
  selectedTrack,
  setSelectedTrack,
}: {
  files: GpxFileRecordForDisplay[];
  visibleTrackKeys: Set<string> | null | undefined;
  selectedTrack: SelectedTrack | null;
  setSelectedTrack: (v: SelectedTrack | null) => void;
}) {
  const map = useMap();
  const layersRef = useRef<ReturnType<typeof import("leaflet").layerGroup> | null>(null);
  const trackLayersRef = useRef<TrackLayerRef[]>([]);
  const renderedFileIdsRef = useRef<Set<string>>(new Set());
  const visibleTrackKeysRef = useRef<Set<string> | null>(null);
  const lastProcessedFilesKeyRef = useRef<string>("");
  const filesKey = files.map((f) => f.id).sort().join(",");
  const DEBUG_GPX_OVERLAY = true; // set to false to disable [GpxOverlay] console logs

  useEffect(() => {
    if (!layersRef.current) {
      const overlay = L.layerGroup().addTo(map);
      layersRef.current = overlay;
    }
    const overlay = layersRef.current;
    const newFileIds = new Set(files.map((f) => f.id));

    const onMapClick = () => setSelectedTrack(null);
    map.on("click", onMapClick);

    // When only deps like visibleTrackKeys changed (same file set), skip all layer logic
    // so we don't touch the overlay and risk double-remove or re-run races.
    if (files.length > 0 && filesKey === lastProcessedFilesKeyRef.current) {
      if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] filesKey unchanged → skip (no layer changes)");
      visibleTrackKeysRef.current = visibleTrackKeys != null ? visibleTrackKeys : null;
      return () => map.off("click", onMapClick);
    }
    lastProcessedFilesKeyRef.current = filesKey;

    const prevIds = renderedFileIdsRef.current;
    const onlyAddingFiles =
      files.length > 0 &&
      prevIds.size < newFileIds.size &&
      [...prevIds].every((id) => newFileIds.has(id));
    const onlyRemovingFiles =
      files.length > 0 &&
      newFileIds.size < prevIds.size &&
      [...newFileIds].every((id) => prevIds.has(id));
    const sameFileSet =
      newFileIds.size === prevIds.size &&
      [...newFileIds].every((id) => prevIds.has(id));

    if (DEBUG_GPX_OVERLAY) {
      console.log("[GpxOverlay] effect run", {
        filesCount: files.length,
        fileIds: files.map((f) => f.id),
        filesKey,
        prevIds: [...prevIds],
        newFileIds: [...newFileIds],
        onlyAddingFiles,
        onlyRemovingFiles,
        sameFileSet,
        trackLayersCount: trackLayersRef.current.length,
      });
    }

    if (files.length === 0) {
      if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] files.length=0 → clearAll");
      overlay.clearLayers();
      trackLayersRef.current = [];
      renderedFileIdsRef.current = new Set();
      visibleTrackKeysRef.current = visibleTrackKeys != null ? visibleTrackKeys : null;
      return () => map.off("click", onMapClick);
    }

    // Remove layers for files no longer in the list (e.g. user unchecked one).
    const toRemove = trackLayersRef.current.filter((r) => !newFileIds.has(r.fileId));
    if (DEBUG_GPX_OVERLAY && toRemove.length > 0) {
      const removedIds = [...new Set(toRemove.map((r) => r.fileId))];
      console.log("[GpxOverlay] removeLayers", { count: toRemove.length, fileIds: removedIds });
    }
    for (const ref of toRemove) {
      overlay.removeLayer(ref.poly);
      overlay.removeLayer(ref.hitPoly);
    }
    trackLayersRef.current = trackLayersRef.current.filter((r) => newFileIds.has(r.fileId));
    renderedFileIdsRef.current = new Set(
      [...renderedFileIdsRef.current].filter((id) => newFileIds.has(id))
    );

    // When only removing: we already removed those layers above; do not clear the overlay.
    if (onlyRemovingFiles) {
      if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] path: onlyRemovingFiles → return (no clear)");
      visibleTrackKeysRef.current = visibleTrackKeys != null ? visibleTrackKeys : null;
      return () => map.off("click", onMapClick);
    }

    // When same set of files (e.g. effect re-ran due to visibleTrackKeys): do not clear
    // or we would wipe the map and rely on async to repaint; a later run can cancel that async.
    if (sameFileSet) {
      if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] path: sameFileSet → return (no clear)");
      visibleTrackKeysRef.current = visibleTrackKeys != null ? visibleTrackKeys : null;
      return () => map.off("click", onMapClick);
    }

    const doFullRefresh = () => {
      overlay.clearLayers();
      trackLayersRef.current = [];
      renderedFileIdsRef.current = new Set();
    };

    if (!onlyAddingFiles) {
      if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] path: fullRefresh → clear + async");
      doFullRefresh();
    } else {
      if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] path: onlyAddingFiles → async add new only");
    }

    let cancelled = false;
    const filesToFetch = onlyAddingFiles ? files.filter((f) => !prevIds.has(f.id)) : files;
    if (DEBUG_GPX_OVERLAY) {
      console.log("[GpxOverlay] async filesToFetch", {
        count: filesToFetch.length,
        ids: filesToFetch.map((f) => f.id),
      });
    }

    (async () => {
      for (const rec of filesToFetch) {
        if (cancelled || !overlay) {
          if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] async cancelled or no overlay, exit");
          return;
        }
        const color = rec.color || "#3b82f6";
        const { tracks } = await getDisplayGeometry(rec);
        if (cancelled || !overlay) {
          if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] async cancelled after getDisplayGeometry", rec.id);
          return;
        }
        tracks.forEach((track, trackIndex) => {
          const key = `${rec.id}-${trackIndex}`;
          if (visibleTrackKeys != null && !visibleTrackKeys.has(key)) return;
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
        renderedFileIdsRef.current.add(rec.id);
        if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] async added file", rec.id, "tracks", tracks.length);
      }
      if (!onlyAddingFiles) {
        renderedFileIdsRef.current = new Set(files.map((f) => f.id));
      }
      visibleTrackKeysRef.current = visibleTrackKeys != null ? visibleTrackKeys : null;
      if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] async done", { renderedIds: [...renderedFileIdsRef.current] });
    })();
    return () => {
      cancelled = true;
      if (DEBUG_GPX_OVERLAY) console.log("[GpxOverlay] cleanup (cancelled=true)");
      map.off("click", onMapClick);
    };
  }, [map, files, filesKey, visibleTrackKeys, setSelectedTrack]);

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
          if (!attrs) return;
          layerInstance.bindPopup(formatParcelPopupContent(attrs), {
            maxWidth: 320,
            className: "parcel-popup",
          });
          const popup = layerInstance.getPopup();
          const parceloid = attrs.parceloid != null && Number.isFinite(attrs.parceloid) ? Number(attrs.parceloid) : null;
          if (popup && parceloid !== null) {
            popup.on("add", function onOpen() {
              popup.off("add", onOpen);
              fetchCamaByParcelOid(parceloid).then((cama) => {
                if (popup.isOpen() && cama) popup.setContent(formatParcelPopupContent(attrs, cama));
              });
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
  files: filesProp,
  visibleTrackKeys = null,
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
  const [artifactTracksByFileId, setArtifactTracksByFileId] = useState<
    Record<string, EnrichedTrackSummaryForDisplay[]>
  >({});
  /** Per-track "fileId-trackIndex" -> failure timestamp. Retry allowed after RETRY_AFTER_MS. Cleared when files list ref changes. */
  const artifactLoadFailedTrackTimestamps = useRef<Map<string, number>>(new Map());
  const RETRY_AFTER_MS = 10_000;
  /** Track key (fileId-trackIndex) while artifact fetch is in flight, so we can show "Loading profile…". */
  const [artifactLoadingTrackKey, setArtifactLoadingTrackKey] = useState<string | null>(null);
  const prevFilesRef = useRef(files);
  if (prevFilesRef.current !== files) {
    prevFilesRef.current = files;
    artifactLoadFailedTrackTimestamps.current.clear();
  }
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedTrackPoints, setSelectedTrackPoints] = useState<[number, number][] | null>(null);
  const [chartDistanceRange, setChartDistanceRange] = useState<{ minD: number; maxD: number } | null>(null);
  const [minSpanMiles, setMinSpanMiles] = useState<number | null>(null);
  const ignoreMapSyncRef = useRef(false);
  /** When set, FitToSelectedTrack skips fitBounds (range was just updated from map zoom/pan, not chart drag). */
  const skipFitForMapSyncRef = useRef(false);

  useEffect(() => {
    if (
      visibleTrackKeys != null &&
      selectedTrack &&
      !visibleTrackKeys.has(`${selectedTrack.fileId}-${selectedTrack.trackIndex}`)
    ) {
      setSelectedTrack(null);
    }
  }, [visibleTrackKeys, selectedTrack]);

  useEffect(() => {
    setHoveredIndex(null);
    setSelectedTrackPoints(null);
    setChartDistanceRange(null);
  }, [selectedTrack]);

  useEffect(() => {
    if (!selectedTrack) return;
    const file = files.find((f) => f.id === selectedTrack.fileId);
    if (!file) return;
    let cancelled = false;
    getDisplayGeometry(file).then(({ tracks }) => {
      if (cancelled) return;
      const track = tracks[selectedTrack.trackIndex];
      setSelectedTrackPoints(track?.points && track.points.length >= 2 ? track.points : null);
    });
    return () => {
      cancelled = true;
    };
  }, [files, selectedTrack]);

  useEffect(() => {
    if (!selectedTrack) return;
    const file = files.find((f) => f.id === selectedTrack.fileId);
    if (!file?.hasEnrichmentArtifact) {
      setArtifactLoadingTrackKey(null);
      return;
    }
    const trackKey = `${file.id}-${selectedTrack.trackIndex}`;
    const failedAt = artifactLoadFailedTrackTimestamps.current.get(trackKey);
    if (failedAt != null && Date.now() - failedAt < RETRY_AFTER_MS) return;
    const existing = artifactTracksByFileId[file.id];
    if (existing?.[selectedTrack.trackIndex]?.elevationProfileJson != null) return;
    let cancelled = false;
    setArtifactLoadingTrackKey(trackKey);
    const fetchStart = typeof performance !== "undefined" ? performance.now() : 0;
    const url = `/api/gpx/files/${file.id}/enrichment-artifact?trackIndex=${selectedTrack.trackIndex}`;
    fetch(url, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return { ok: false as const, json: null, status: res.status };
        const json = await res.text();
        const sizeHeader = res.headers.get("X-Artifact-Size-Bytes");
        const sliceBytes = sizeHeader != null ? parseInt(sizeHeader, 10) : null;
        return { ok: true as const, json: json || null, sliceBytes: Number.isNaN(sliceBytes as number) ? null : sliceBytes };
      })
      .then((result) => {
        if (cancelled) return;
        const fetchMs = typeof performance !== "undefined" ? performance.now() - fetchStart : 0;
        if (!result.ok || !result.json) {
          if (!cancelled) setArtifactLoadingTrackKey(null);
          artifactLoadFailedTrackTimestamps.current.set(trackKey, Date.now());
          const statusCode = !result.ok && "status" in result ? (result as { status: number }).status : undefined;
          console.warn("[MapView] Per-track artifact fetch failed; summary-only fallback.", {
            fileId: file.id,
            trackIndex: selectedTrack.trackIndex,
            status: statusCode,
            fetchMs: fetchMs.toFixed(0),
          });
          return;
        }
        const parseStart = typeof performance !== "undefined" ? performance.now() : 0;
        const oneTrack = parseEnrichedTrackSliceToDisplay(result.json);
        const parseMs = typeof performance !== "undefined" ? performance.now() - parseStart : 0;
        if (oneTrack) {
          if (!cancelled) setArtifactLoadingTrackKey(null);
          if (process.env.NODE_ENV === "development" || fetchMs > 500 || (result.sliceBytes != null && result.sliceBytes > 500_000)) {
            console.info("[MapView] Per-track artifact success", {
              fileId: file.id,
              trackIndex: selectedTrack.trackIndex,
              sliceBytes: result.sliceBytes ?? "unknown",
              fetchMs: fetchMs.toFixed(0),
              parseMs: parseMs.toFixed(0),
            });
          }
          const base = file.enrichedTracks ?? existing ?? [];
          const merged = base.length > 0 ? base.map((t, i) => (i === selectedTrack.trackIndex ? oneTrack : t)) : [];
          if (merged.length <= selectedTrack.trackIndex) {
            merged[selectedTrack.trackIndex] = oneTrack;
          }
          setArtifactTracksByFileId((prev) => ({ ...prev, [file.id]: merged }));
          artifactLoadFailedTrackTimestamps.current.delete(trackKey);
        } else {
          if (!cancelled) setArtifactLoadingTrackKey(null);
          artifactLoadFailedTrackTimestamps.current.set(trackKey, Date.now());
          console.warn("[MapView] Per-track artifact parse failed; summary-only fallback.", {
            fileId: file.id,
            trackIndex: selectedTrack.trackIndex,
            fetchMs: fetchMs.toFixed(0),
            parseMs: parseMs.toFixed(0),
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setArtifactLoadingTrackKey(null);
          artifactLoadFailedTrackTimestamps.current.set(trackKey, Date.now());
          const fetchMs = typeof performance !== "undefined" ? performance.now() - fetchStart : 0;
          console.warn("[MapView] Per-track artifact fetch error; summary-only fallback.", {
            fileId: file.id,
            trackIndex: selectedTrack.trackIndex,
            error: err instanceof Error ? err.message : String(err),
            fetchMs: fetchMs.toFixed(0),
          });
        }
      });
    return () => {
      cancelled = true;
      setArtifactLoadingTrackKey(null);
    };
  }, [files, selectedTrack, artifactTracksByFileId]);

  const selectedProfile = useMemo(() => {
    if (!selectedTrack) return null;
    const file = files.find((f) => f.id === selectedTrack.fileId);
    const tracks =
      file?.id && artifactTracksByFileId[file.id] != null
        ? artifactTracksByFileId[file.id]
        : file?.enrichedTracks;
    const track = tracks?.[selectedTrack.trackIndex];
    if (!track) return null;
    const profilePoints = parseProfileJson(track.elevationProfileJson);
    return { trackName: track.name, profilePoints, track };
  }, [files, selectedTrack, artifactTracksByFileId]);

  const profilePanelMessage = useMemo(() => {
    if (!selectedTrack) return "Elevation profile not available for this track.";
    const file = files.find((f) => f.id === selectedTrack.fileId);
    const trackKey = file ? `${file.id}-${selectedTrack.trackIndex}` : "";
    const loading = Boolean(file?.hasEnrichmentArtifact && artifactLoadingTrackKey === trackKey);
    return loading ? "Loading profile…" : "Elevation profile not available for this track.";
  }, [files, selectedTrack, artifactLoadingTrackKey]);

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

  const handleChartZoomChange = useCallback(
    (range: { minD: number; maxD: number } | null) => {
      if (range === null) {
        setChartDistanceRange(null);
        return;
      }
      const profilePts = selectedProfile?.profilePoints;
      if (!profilePts?.length) {
        setChartDistanceRange(range);
        return;
      }
      const dVals = profilePts.map((p) => p.d).filter((d) => Number.isFinite(d));
      if (dVals.length < 2) {
        setChartDistanceRange(range);
        return;
      }
      const baseMin = Math.min(...dVals);
      const baseMax = Math.max(...dVals);
      const span = range.maxD - range.minD;
      const minSpan = minSpanMiles ?? 0;
      if (minSpan > 0 && span < minSpan) {
        const center = (range.minD + range.maxD) / 2;
        const half = minSpan / 2;
        let newMin = center - half;
        let newMax = center + half;
        if (newMin < baseMin) {
          newMin = baseMin;
          newMax = Math.min(baseMax, baseMin + minSpan);
        }
        if (newMax > baseMax) {
          newMax = baseMax;
          newMin = Math.max(baseMin, baseMax - minSpan);
        }
        setChartDistanceRange({ minD: newMin, maxD: newMax });
      } else {
        setChartDistanceRange(range);
      }
    },
    [selectedProfile?.profilePoints, minSpanMiles]
  );

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
          <ParcelOverlay enabled={parcelsEnabled} />
          {/* GpxOverlay and MapHoverMarker render above parcel layer so track click/hover work. */}
          <GpxOverlay
            files={files}
            visibleTrackKeys={visibleTrackKeys}
            selectedTrack={selectedTrack}
            setSelectedTrack={setSelectedTrack}
          />
          <MapHoverMarker hoveredLatLng={hoveredLatLng} />
          <FitToSelection
            files={files}
            visibleTrackKeys={visibleTrackKeys}
            fitToSelectionTrigger={fitToSelectionTrigger}
            bottomPaddingPx={selectedTrack ? BOTTOM_PANEL_HEIGHT_PX : 0}
            maxZoom={basemap.maxZoom ?? DEFAULT_FIT_MAX_ZOOM}
          />
          <FitToSelectedTrack
            files={files}
            selectedTrack={selectedTrack}
            chartDistanceRange={chartDistanceRange}
            profilePoints={selectedProfile?.profilePoints ?? null}
            trackPoints={selectedTrackPoints}
            bottomPaddingPx={selectedTrack ? BOTTOM_PANEL_HEIGHT_PX : 0}
            maxZoom={basemap.maxZoom ?? DEFAULT_FIT_MAX_ZOOM}
            ignoreMapSyncRef={ignoreMapSyncRef}
            skipFitForMapSyncRef={skipFitForMapSyncRef}
          />
          <MapToChartSync
            maxZoom={basemap.maxZoom ?? DEFAULT_FIT_MAX_ZOOM}
            profilePoints={selectedProfile?.profilePoints ?? null}
            trackPoints={selectedTrackPoints}
            currentChartRange={chartDistanceRange}
            onMinSpanMiles={setMinSpanMiles}
            onVisibleRangeChange={setChartDistanceRange}
            ignoreMapSyncRef={ignoreMapSyncRef}
            skipFitForMapSyncRef={skipFitForMapSyncRef}
          />
          <MapResizeOnSelectionClear selectedTrack={selectedTrack} />
        </MapContainer>
      </div>
      {selectedTrack && (
        <div className="flex h-[320px] shrink-0 gap-0 border-t border-slate-700 bg-slate-900/98 overflow-hidden">
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
          <div className="min-w-0 flex-1 p-2 flex flex-col min-h-0">
            {selectedProfile?.profilePoints && selectedProfile.profilePoints.length >= 2 ? (
              <TrackProfilePanel
                trackName={selectedProfile.trackName}
                profilePoints={selectedProfile.profilePoints}
                trackPoints={selectedTrackPoints}
                hoveredIndex={hoveredIndex}
                onHoverIndex={onHoverIndex}
                chartDistanceRange={chartDistanceRange}
                onChartZoomChange={handleChartZoomChange}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                {profilePanelMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
