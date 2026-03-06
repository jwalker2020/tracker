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
  created: string;
  updated: string;
};

const COLLECTION = "gpx_files";

export async function getGpxFilesList(): Promise<GpxFileRecord[]> {
  const res = await pb.collection(COLLECTION).getList<GpxFileRecord>(1, 500, {
    sort: "-created",
  });
  return res.items;
}

export function getGpxFileUrl(recordId: string, fileName: string, baseUrl: string): string {
  return `${baseUrl}/api/files/${COLLECTION}/${recordId}/${fileName}`;
}
