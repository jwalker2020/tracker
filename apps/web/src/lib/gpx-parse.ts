export type GpxBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type GpxTrack = {
  name: string;
  points: Array<[number, number]>;
};

export type GpxParseResult = {
  bounds: GpxBounds;
  centerLat: number;
  centerLng: number;
  trackCount: number;
  pointCount: number;
  tracks: GpxTrack[];
};

function parseFloatAttr(el: Element, name: string): number {
  const v = el.getAttribute(name);
  return v ? parseFloat(v) : 0;
}

function getTrkPoints(doc: Document): GpxTrack[] {
  const tracks: GpxTrack[] = [];
  let trkIndex = 0;
  const trks = doc.querySelectorAll("trk");
  trks.forEach((trk) => {
    const nameEl = trk.querySelector("name");
    const name = nameEl?.textContent?.trim() || `Track ${++trkIndex}`;
    const points: [number, number][] = [];
    trk.querySelectorAll("trkpt").forEach((pt) => {
      const lat = parseFloatAttr(pt, "lat");
      const lon = parseFloatAttr(pt, "lon");
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) points.push([lat, lon]);
    });
    if (points.length > 0) tracks.push({ name, points });
  });
  let rteIndex = 0;
  const rtes = doc.querySelectorAll("rte");
  rtes.forEach((rte) => {
    const nameEl = rte.querySelector("name");
    const name = nameEl?.textContent?.trim() || `Route ${++rteIndex}`;
    const points: [number, number][] = [];
    rte.querySelectorAll("rtept").forEach((pt) => {
      const lat = parseFloatAttr(pt, "lat");
      const lon = parseFloatAttr(pt, "lon");
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) points.push([lat, lon]);
    });
    if (points.length > 0) tracks.push({ name, points });
  });
  return tracks;
}

export function parseGpx(gpxText: string): GpxParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "text/xml");
  const tracks = getTrkPoints(doc);

  let pointCount = 0;
  let minLat = Infinity,
    minLng = Infinity,
    maxLat = -Infinity,
    maxLng = -Infinity,
    sumLat = 0,
    sumLng = 0;

  for (const seg of tracks) {
    pointCount += seg.points.length;
    for (const [lat, lng] of seg.points) {
      minLat = Math.min(minLat, lat);
      minLng = Math.min(minLng, lng);
      maxLat = Math.max(maxLat, lat);
      maxLng = Math.max(maxLng, lng);
      sumLat += lat;
      sumLng += lng;
    }
  }

  const valid = pointCount > 0;
  const bounds: GpxBounds = valid
    ? { south: minLat, west: minLng, north: maxLat, east: maxLng }
    : { south: 0, west: 0, north: 0, east: 0 };
  const centerLat = valid ? sumLat / pointCount : 0;
  const centerLng = valid ? sumLng / pointCount : 0;

  return {
    bounds,
    centerLat,
    centerLng,
    trackCount: tracks.length,
    pointCount,
    tracks,
  };
}

export function boundsToJson(bounds: GpxBounds): string {
  return JSON.stringify(bounds);
}
