/**
 * Basemap definitions for the Leaflet map.
 * Add or edit entries here to change available basemaps without modifying the map component.
 */
export type BasemapConfig = {
  id: string;
  name: string;
  url: string;
  attribution: string;
  maxZoom?: number;
  subdomains?: string | string[];
};

export const BASEMAPS: BasemapConfig[] = [
  {
    id: "usgs",
    name: "USGS Topo",
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    attribution: "USGS",
    maxZoom: 16,
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    subdomains: "abc",
  },
  {
    id: "esri-imagery",
    name: "Esri Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
  {
    id: "carto-positron",
    name: "CARTO Positron",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20,
    subdomains: "abcd",
  },
  {
    id: "stamen-terrain",
    name: "Stamen Terrain",
    url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://stamen.com/">Stamen Design</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  },
];

const ID_SET = new Set(BASEMAPS.map((b) => b.id));

export function getBasemapById(id: string): BasemapConfig | undefined {
  return BASEMAPS.find((b) => b.id === id);
}

export function isValidBasemapId(id: string): boolean {
  return ID_SET.has(id);
}

/** Default basemap id (USGS Topo). */
export const DEFAULT_BASEMAP_ID = "usgs";
