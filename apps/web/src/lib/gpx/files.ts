import pb from "@/lib/pocketbase";
import { metersToFeet } from "@/lib/units";

/**
 * Enhancement performance/throughput metrics for a GPX enrichment run.
 * Stored as JSON on gpx_files.performanceJson for analysis.
 */
export type GpxEnhancementPerformance = {
  totalTracks: number;
  totalPoints: number;
  enhancementStartTime: string;
  enhancementEndTime?: string;
  enhancementDurationMs: number;
  pointsPerMinute: number;
  status?: "completed" | "failed";
  processedPoints?: number;
  currentPhase?: string;
  averagePointsPerSecond?: number;
};

/** Build performance object from timing and counts. Handles divide-by-zero for pointsPerMinute. */
export function buildEnhancementPerformance(
  startTimeMs: number,
  endTimeMs: number,
  totalTracks: number,
  totalPoints: number,
  status: "completed" | "failed" = "completed",
  processedPoints?: number,
  currentPhase?: string
): GpxEnhancementPerformance {
  const durationMs = Math.max(0, endTimeMs - startTimeMs);
  const minutes = durationMs / 60_000;
  const pointsPerMinute = minutes > 0 && Number.isFinite(totalPoints) ? totalPoints / minutes : 0;
  const seconds = durationMs / 1_000;
  const averagePointsPerSecond = seconds > 0 && Number.isFinite(totalPoints) ? totalPoints / seconds : 0;
  return {
    totalTracks,
    totalPoints,
    enhancementStartTime: new Date(startTimeMs).toISOString(),
    enhancementEndTime: new Date(endTimeMs).toISOString(),
    enhancementDurationMs: durationMs,
    pointsPerMinute: Math.round(pointsPerMinute * 100) / 100,
    status,
    ...(processedPoints != null && { processedPoints }),
    ...(currentPhase != null && { currentPhase }),
    averagePointsPerSecond: Math.round(averagePointsPerSecond * 100) / 100,
  };
}

/** Internal record from PocketBase; elevation and distance are in meters. */
export type GpxFileRecord = {
  id: string;
  name: string;
  file: string;
  uploadedBy?: string;
  /** Owner (PocketBase user id). Set for multi-user isolation. */
  user?: string;
  boundsJson: string;
  centerLat: number;
  centerLng: number;
  trackCount: number;
  pointCount: number;
  color: string;
  distanceM?: number;
  minElevationM?: number;
  maxElevationM?: number;
  totalAscentM?: number;
  totalDescentM?: number;
  averageGradePct?: number;
  enrichedGeoJson?: string;
  /** Legacy: single combined profile (meters). Prefer enrichedTracksJson. */
  elevationProfileJson?: string;
  /** Per-track enrichment: JSON array of EnrichedTrackSummary (meters). */
  enrichedTracksJson?: string;
  /** JSON: GpxEnhancementPerformance — enhancement run timing and throughput metrics. */
  performanceJson?: string;
  sortOrder?: number;
  created: string;
  updated: string;
};

/** Per-track enrichment for display (feet). */
export type EnrichedTrackSummaryForDisplay = {
  trackIndex: number;
  name: string;
  pointCount: number;
  bounds: { south: number; west: number; north: number; east: number };
  centerLat: number;
  centerLng: number;
  distanceFt: number;
  minElevationFt: number;
  maxElevationFt: number;
  totalAscentFt: number;
  totalDescentFt: number;
  averageGradePct: number;
  averageSteepnessPct: number;
  /** Average curviness in degrees per mile (0 = straight; higher = more winding). */
  averageCurvinessDegPerMile: number;
  validCount: number;
  elevationProfileJson: string | null;
};

/**
 * User-facing record with elevation and distance in feet.
 * Use this type for API responses and UI; convert from GpxFileRecord with gpxRecordToDisplay.
 */
export type GpxFileRecordForDisplay = Omit<
  GpxFileRecord,
  "distanceM" | "minElevationM" | "maxElevationM" | "totalAscentM" | "totalDescentM"
> & {
  distanceFt?: number;
  minElevationFt?: number;
  maxElevationFt?: number;
  totalAscentFt?: number;
  totalDescentFt?: number;
  /** Per-track enrichment (feet). Use for track popup and filtering. */
  enrichedTracks?: EnrichedTrackSummaryForDisplay[];
};

/** Convert internal (meters) record to display (feet) for client/UI. */
export function gpxRecordToDisplay(record: GpxFileRecord): GpxFileRecordForDisplay {
  const {
    distanceM,
    minElevationM,
    maxElevationM,
    totalAscentM,
    totalDescentM,
    elevationProfileJson,
    enrichedTracksJson,
    ...rest
  } = record;
  const out: GpxFileRecordForDisplay = {
    ...rest,
    ...(distanceM != null && { distanceFt: metersToFeet(distanceM) }),
    ...(minElevationM != null && { minElevationFt: metersToFeet(minElevationM) }),
    ...(maxElevationM != null && { maxElevationFt: metersToFeet(maxElevationM) }),
    ...(totalAscentM != null && { totalAscentFt: metersToFeet(totalAscentM) }),
    ...(totalDescentM != null && { totalDescentFt: metersToFeet(totalDescentM) }),
  };

  if (enrichedTracksJson) {
    try {
      const tracks = JSON.parse(enrichedTracksJson) as Array<{
        trackIndex: number;
        name: string;
        pointCount: number;
        bounds: { south: number; west: number; north: number; east: number };
        centerLat: number;
        centerLng: number;
        distanceM: number;
        minElevationM: number;
        maxElevationM: number;
        totalAscentM: number;
        totalDescentM: number;
        averageGradePct: number;
        averageSteepnessPct?: number;
        averageCurvinessDegPerMile?: number;
        validCount: number;
        elevationProfileJson: string | null;
      }>;
      if (Array.isArray(tracks)) {
        out.enrichedTracks = tracks.map((t) => ({
          trackIndex: t.trackIndex,
          name: t.name,
          pointCount: t.pointCount,
          bounds: t.bounds,
          centerLat: t.centerLat,
          centerLng: t.centerLng,
          distanceFt: metersToFeet(t.distanceM),
          minElevationFt: metersToFeet(t.minElevationM),
          maxElevationFt: metersToFeet(t.maxElevationM),
          totalAscentFt: metersToFeet(t.totalAscentM),
          totalDescentFt: metersToFeet(t.totalDescentM),
          averageGradePct: t.averageGradePct,
          averageSteepnessPct: typeof t.averageSteepnessPct === "number" ? t.averageSteepnessPct : 0,
          averageCurvinessDegPerMile:
            typeof t.averageCurvinessDegPerMile === "number" && Number.isFinite(t.averageCurvinessDegPerMile)
              ? t.averageCurvinessDegPerMile
              : 0,
          validCount: t.validCount,
          elevationProfileJson: (() => {
            if (!t.elevationProfileJson) return null;
            try {
              const profile = JSON.parse(t.elevationProfileJson) as { d: number; e: number }[];
              if (!Array.isArray(profile) || profile.length === 0) return t.elevationProfileJson;
              const maxD = Math.max(...profile.map((p) => p.d));
              if (maxD > 20) {
                return JSON.stringify(
                  profile.map((p) => ({
                    d: metersToFeet(p.d) / 5280,
                    e: metersToFeet(p.e),
                  }))
                );
              }
              return t.elevationProfileJson;
            } catch {
              return t.elevationProfileJson;
            }
          })(),
        }));
      }
    } catch {
      // leave enrichedTracks undefined
    }
  }

  return out;
}

const COLLECTION = "gpx_files";

/**
 * Returns GPX file records for the given user. Only records owned by that user are returned.
 * Legacy records with no user are excluded.
 */
export async function getGpxFilesList(userId: string): Promise<GpxFileRecord[]> {
  const res = await pb.collection(COLLECTION).getList<GpxFileRecord>(1, 500, {
    filter: `user = "${userId}"`,
  });
  res.items.sort((a, b) => {
    const aOrder = a.sortOrder ?? Infinity;
    const bOrder = b.sortOrder ?? Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return new Date(b.created).getTime() - new Date(a.created).getTime();
  });
  return res.items;
}

export function getGpxFileUrl(recordId: string, fileName: string, baseUrl: string): string {
  return `${baseUrl}/api/files/${COLLECTION}/${recordId}/${fileName}`;
}
