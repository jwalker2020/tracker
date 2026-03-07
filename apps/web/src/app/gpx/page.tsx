import { getGpxFilesList } from "@/lib/gpx";
import { GpxView } from "@/components/gpx/GpxView";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL ?? "";

export default async function GpxPage() {
  let initialFiles: Awaited<ReturnType<typeof getGpxFilesList>> = [];
  let initialError: string | undefined;
  if (!PB_URL) {
    initialError = "NEXT_PUBLIC_PB_URL is not set. Add it in apps/web/.env.local.";
  } else {
    try {
      initialFiles = await getGpxFilesList();
    } catch {
      initialFiles = [];
      initialError = "Could not load GPX files. Is PocketBase running?";
    }
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-semibold text-slate-100">GPX Viewer</h1>
      <GpxView
        initialFiles={initialFiles}
        baseUrl={PB_URL}
        initialError={initialError}
      />
    </div>
  );
}
