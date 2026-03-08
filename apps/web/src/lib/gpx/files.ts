import pb from "@/lib/pocketbase";
import { metersToFeet } from "@/lib/units";

/** Internal record from PocketBase; elevation and distance are in meters. */
export type GpxFileRecord = {
  id: string;
  name: string;
  file: string;
  uploadedBy?: string;
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
  /** Optional JSON array of { d: distanceM, e: elevationM } from DEM enrichment (internal: meters). */
  elevationProfileJson?: string;
  sortOrder?: number;
  created: string;
  updated: string;
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
  /** JSON array of { d: distanceFt, e: elevationFt } for charts/UI. */
  elevationProfileJson?: string;
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
  if (elevationProfileJson) {
    try {
      const profile = JSON.parse(elevationProfileJson) as { d: number; e: number }[];
      if (Array.isArray(profile)) {
        out.elevationProfileJson = JSON.stringify(
          profile.map((p) => ({ d: metersToFeet(p.d), e: metersToFeet(p.e) }))
        );
      } else {
        out.elevationProfileJson = elevationProfileJson;
      }
    } catch {
      out.elevationProfileJson = elevationProfileJson;
    }
  }
  return out;
}

const COLLECTION = "gpx_files";

export async function getGpxFilesList(): Promise<GpxFileRecord[]> {
  const res = await pb.collection(COLLECTION).getList<GpxFileRecord>(1, 500);
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
