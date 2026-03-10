/**
 * Split a single-track GPX into N tracks by point count (evenly as possible).
 * Preserves point order and all point data (lat, lon, ele, time, etc.).
 * Use only when the GPX has exactly one track (trk or rte).
 * Namespace-safe for GPX 1.1 default namespace.
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

function getTrkOrRte(doc: Document): { element: Element; tag: "trk" | "rte"; pointTag: string } | null {
  const trks = getElementsByLocalName(doc, "trk");
  const rtes = getElementsByLocalName(doc, "rte");
  if (trks.length === 1 && rtes.length === 0) {
    const trk = trks[0]!;
    const pts = getElementsByLocalName(trk, "trkpt");
    if (pts.length > 0) return { element: trk, tag: "trk", pointTag: "trkpt" };
  }
  if (rtes.length === 1 && trks.length === 0) {
    const rte = rtes[0]!;
    const pts = getElementsByLocalName(rte, "rtept");
    if (pts.length > 0) return { element: rte, tag: "rte", pointTag: "rtept" };
  }
  return null;
}

function getTrackName(element: Element): string {
  const nameEl = getElementsByLocalName(element, "name")[0];
  const name = nameEl?.textContent?.trim();
  return name && name.length > 0 ? name : "Track";
}

function createElement(doc: Document, localName: string, ns: string | null): Element {
  if (ns) return doc.createElementNS(ns, localName);
  return doc.createElement(localName);
}

function createText(doc: Document, text: string): Text {
  return doc.createTextNode(text);
}

/**
 * Split a single-track GPX into N tracks by point count.
 * Points are distributed as evenly as possible; order is preserved.
 * Returns the new GPX document as a string, or the original string if the GPX does not have exactly one track.
 */
export function splitSingleTrackGpxByPointCount(gpxText: string, n: number): string {
  if (typeof gpxText !== "string" || !gpxText.trim() || n < 2) return gpxText;

  const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
  if (!parser) return gpxText;

  let doc: Document;
  try {
    doc = parser.parseFromString(gpxText, "text/xml");
  } catch {
    return gpxText;
  }

  const single = getTrkOrRte(doc);
  if (!single) return gpxText;

  const { element: original, tag, pointTag } = single;
  const points = getElementsByLocalName(original, pointTag);
  const pointCount = points.length;
  if (pointCount === 0) return gpxText;

  const numParts = Math.min(n, pointCount);
  if (numParts < 2) return gpxText;

  const baseName = getTrackName(original);
  const ns =
    doc.documentElement.namespaceURI && doc.documentElement.namespaceURI.length > 0
      ? doc.documentElement.namespaceURI
      : null;
  const parent = original.parentNode;
  if (!parent) return gpxText;

  const segmentTag = tag === "trk" ? "trkseg" : null;
  const size = Math.ceil(points.length / numParts);

  for (let part = 0; part < numParts; part++) {
    const start = part * size;
    const end = Math.min(start + size, points.length);
    if (start >= end) continue;

    const trackEl = createElement(doc, tag, ns);
    const nameEl = createElement(doc, "name", ns);
    nameEl.appendChild(createText(doc, `${baseName} (Part ${part + 1})`));
    trackEl.appendChild(nameEl);

    if (segmentTag) {
      const segEl = createElement(doc, segmentTag, ns);
      for (let i = start; i < end; i++) {
        segEl.appendChild(points[i]!.cloneNode(true));
      }
      trackEl.appendChild(segEl);
    } else {
      for (let i = start; i < end; i++) {
        trackEl.appendChild(points[i]!.cloneNode(true));
      }
    }

    parent.insertBefore(trackEl, original);
  }

  parent.removeChild(original);

  try {
    const serializer = typeof XMLSerializer !== "undefined" ? new XMLSerializer() : null;
    if (!serializer) return gpxText;
    return serializer.serializeToString(doc);
  } catch {
    return gpxText;
  }
}
