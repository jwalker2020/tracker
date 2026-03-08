/**
 * Hillshade overlay layer definitions. Render above the basemap, below tracks.
 * User selects one mode: none | usgs | esri (mutually exclusive).
 */
export type HillshadeMode = "none" | "usgs" | "esri";

export type HillshadeLayerConfig = {
  id: Exclude<HillshadeMode, "none">;
  name: string;
  url: string;
  attribution: string;
  opacity?: number;
  maxZoom?: number;
};

/** Default opacity for hillshade (0–1). 0.5 gives a good balance; adjust here to change strength. */
export const DEFAULT_OVERLAY_OPACITY = 0.5;

/** Selectable hillshade layers. "none" is not in this array; it means no hillshade. */
export const HILLSHADE_LAYERS: HillshadeLayerConfig[] = [
  {
    id: "usgs",
    name: "USGS Hillshade",
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
    attribution: "USGS Shaded Relief",
    opacity: DEFAULT_OVERLAY_OPACITY,
    maxZoom: 16,
  },
  {
    id: "esri",
    name: "ESRI World Hillshade",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri World Hillshade",
    opacity: DEFAULT_OVERLAY_OPACITY,
    maxZoom: 15,
  },
];

export const DEFAULT_HILLSHADE_MODE: HillshadeMode = "none";

export function getHillshadeLayerById(id: HillshadeMode): HillshadeLayerConfig | undefined {
  if (id === "none") return undefined;
  return HILLSHADE_LAYERS.find((l) => l.id === id);
}
