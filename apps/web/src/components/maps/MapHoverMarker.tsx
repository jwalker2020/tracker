"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

type MapHoverMarkerProps = {
  /** [lat, lng] when hovering a chart point; null to hide. */
  hoveredLatLng: [number, number] | null;
};

export function MapHoverMarker({ hoveredLatLng }: MapHoverMarkerProps) {
  const map = useMap();
  const circleRef = useRef<L.CircleMarker | null>(null);
  const lastLatLngRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (hoveredLatLng == null) {
      lastLatLngRef.current = null;
      if (circleRef.current) {
        map.removeLayer(circleRef.current);
        circleRef.current = null;
      }
      return () => {};
    }
    const [lat, lng] = hoveredLatLng;
    const prev = lastLatLngRef.current;
    if (circleRef.current) {
      if (prev != null && prev[0] === lat && prev[1] === lng) return () => {
        if (circleRef.current) {
          map.removeLayer(circleRef.current);
          circleRef.current = null;
        }
      };
      lastLatLngRef.current = [lat, lng];
      circleRef.current.setLatLng([lat, lng]);
      return () => {
        if (circleRef.current) {
          map.removeLayer(circleRef.current);
          circleRef.current = null;
        }
      };
    }
    lastLatLngRef.current = [lat, lng];
    const circle = L.circleMarker([lat, lng], {
      radius: 8,
      fillColor: "#38bdf8",
      color: "#0ea5e9",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9,
    });
    circle.addTo(map);
    circle.bringToFront();
    circleRef.current = circle;
    return () => {
      if (circleRef.current) {
        map.removeLayer(circleRef.current);
        circleRef.current = null;
      }
    };
  }, [map, hoveredLatLng]);

  return null;
}
