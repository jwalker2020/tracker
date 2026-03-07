/**
 * New Hampshire state bounding box (WGS84).
 * Approximate from US Census; use for filtering tiles that intersect NH.
 */
/** [west, south, east, north] in decimal degrees. */
export const NH_BBOX = [
    -72.557247, // west
    42.69699, // south
    -70.610621, // east
    45.305476, // north
];
/** Check if two bboxes intersect (both in WGS84 [west, south, east, north]). */
export function bboxIntersects(a, b) {
    const [aWest, aSouth, aEast, aNorth] = a;
    const [bWest, bSouth, bEast, bNorth] = b;
    if (aEast < bWest || bEast < aWest)
        return false;
    if (aNorth < bSouth || bNorth < aSouth)
        return false;
    return true;
}
