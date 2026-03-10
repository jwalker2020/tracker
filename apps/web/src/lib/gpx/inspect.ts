/**
 * Inspect a GPX string to get track and point counts.
 * Namespace-safe: works with GPX 1.1 default namespace (e.g. Strava exports).
 * Returns null if parsing fails or the file has no points.
 */
const GPX_NS = "http://www.topografix.com/GPX/1/1";

function getElementsByLocalName(parent: Element | Document, localName: string): Element[] {
  const out: Element[] = [];
  const list = parent.getElementsByTagNameNS(GPX_NS, localName);
  if (list.length > 0) {
    for (let i = 0; i < list.length; i++) {
      const el = list.item(i);
      if (el) out.push(el);
    }
    return out;
  }
  const fallback = parent.getElementsByTagName(localName);
  for (let i = 0; i < fallback.length; i++) {
    const el = fallback.item(i);
    if (el) out.push(el);
  }
  return out;
}

export function inspectGpxTrackCount(gpxText: string): {
  trackCount: number;
  pointCount: number;
} | null {
  if (typeof gpxText !== "string" || !gpxText.trim()) return null;
  try {
    const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
    if (!parser) return null;
    const doc = parser.parseFromString(gpxText, "text/xml");
    const trks = getElementsByLocalName(doc, "trk");
    const rtes = getElementsByLocalName(doc, "rte");
    let pointCount = 0;
    for (const trk of trks) {
      pointCount += getElementsByLocalName(trk, "trkpt").length;
    }
    for (const rte of rtes) {
      pointCount += getElementsByLocalName(rte, "rtept").length;
    }
    const trackCount = trks.length + rtes.length;
    if (trackCount === 0 || pointCount === 0) return null;
    return { trackCount, pointCount };
  } catch {
    return null;
  }
}
