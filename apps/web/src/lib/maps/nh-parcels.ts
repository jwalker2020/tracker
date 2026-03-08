/**
 * NH GRANIT parcel overlay: bounds-based query from ArcGIS Feature Server.
 * Query only parcels in the current map bounds; do not load statewide data.
 */

const PARCEL_LAYER_URL =
  "https://granit24a.sr.unh.edu/hosting/rest/services/Hosted/CAD_ParcelMosaic/FeatureServer/1";

/** Max parcels per query to keep responses and rendering manageable. */
const MAX_RECORD_COUNT = 500;

export const NH_PARCELS_ATTRIBUTION = "NH GRANIT / NH Department of Revenue Administration";

export type ParcelBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** GeoJSON Feature with properties from the parcel layer (only fields we use). */
export type ParcelFeature = GeoJSON.Feature<GeoJSON.Polygon, ParcelAttributes>;

export type ParcelAttributes = {
  town?: string | null;
  name?: string | null;
  streetaddress?: string | null;
  displayid?: string | null;
  pid?: string | null;
  nh_gis_id?: string | null;
  SHAPE__Area?: number | null;
  slu?: string | null;
  [key: string]: unknown;
};

export type ParcelGeoJSON = GeoJSON.FeatureCollection<GeoJSON.Polygon, ParcelAttributes>;

/**
 * Fetch parcels that intersect the given WGS84 bounds.
 * Uses ArcGIS REST query with envelope; returns GeoJSON for Leaflet.
 */
export async function fetchParcelsInBounds(bounds: ParcelBounds): Promise<ParcelGeoJSON> {
  const envelope = {
    xmin: bounds.west,
    ymin: bounds.south,
    xmax: bounds.east,
    ymax: bounds.north,
    spatialReference: { wkid: 4326 },
  };
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify(envelope),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    returnGeometry: "true",
    outFields: "town,name,streetaddress,displayid,pid,nh_gis_id,SHAPE__Area,slu,sluc,slum",
    resultRecordCount: String(MAX_RECORD_COUNT),
    f: "geojson",
  });
  const url = `${PARCEL_LAYER_URL}/query?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Parcel query failed: ${res.status}`);
  const data = (await res.json()) as ParcelGeoJSON;
  if (!data.features) return { type: "FeatureCollection", features: [] };
  return data;
}

/** Build a short label for popup: show only attributes that exist. */
export function formatParcelPopupContent(attrs: ParcelAttributes): string {
  const lines: string[] = [];
  if (attrs.town) lines.push(`<strong>Town</strong>: ${escapeHtml(attrs.town)}`);
  if (attrs.displayid) lines.push(`<strong>Map-Lot</strong>: ${escapeHtml(attrs.displayid)}`);
  if (attrs.pid) lines.push(`<strong>PID</strong>: ${escapeHtml(attrs.pid)}`);
  if (attrs.nh_gis_id) lines.push(`<strong>NH GIS ID</strong>: ${escapeHtml(attrs.nh_gis_id)}`);
  if (attrs.name) lines.push(`<strong>Owner</strong>: ${escapeHtml(attrs.name)}`);
  if (attrs.streetaddress) lines.push(`<strong>Address</strong>: ${escapeHtml(attrs.streetaddress)}`);
  if (attrs.SHAPE__Area != null && Number.isFinite(attrs.SHAPE__Area)) {
    const acres = (attrs.SHAPE__Area / 43560).toFixed(2);
    lines.push(`<strong>Acreage</strong>: ${acres} ac`);
  }
  if (attrs.slu) lines.push(`<strong>Land use</strong>: ${escapeHtml(attrs.slu)}`);
  if (attrs.sluc) lines.push(`<strong>Land use code</strong>: ${escapeHtml(attrs.sluc)}`);
  if (lines.length === 0) return "No attributes available.";
  return lines.join("<br/>");
}

function escapeHtml(s: string): string {
  const el = document.createElement("div");
  el.textContent = s;
  return el.innerHTML;
}
