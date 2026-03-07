/**
 * New Hampshire state bounding box (WGS84).
 * Approximate from US Census; use for filtering tiles that intersect NH.
 */
import type { Wgs84Bbox } from "./types.js";
/** [west, south, east, north] in decimal degrees. */
export declare const NH_BBOX: Wgs84Bbox;
/** Check if two bboxes intersect (both in WGS84 [west, south, east, north]). */
export declare function bboxIntersects(a: Wgs84Bbox, b: Wgs84Bbox): boolean;
