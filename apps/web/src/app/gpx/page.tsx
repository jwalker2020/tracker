import { getGpxFilesList } from "@/lib/gpx-files";
import { GpxView } from "@/components/gpx/GpxView";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL ?? "";

export default async function GpxPage() {
  let initialFiles: Awaited<ReturnType<typeof getGpxFilesList>> = [];
  if (PB_URL) {
    try {
      initialFiles = await getGpxFilesList();
    } catch {
      initialFiles = [];
    }
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-semibold text-slate-100">GPX Viewer</h1>
      <GpxView initialFiles={initialFiles} baseUrl={PB_URL} />
    </div>
  );
}
