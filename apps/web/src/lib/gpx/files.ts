import pb from "@/lib/pocketbase";

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
  sortOrder?: number;
  created: string;
  updated: string;
};

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
