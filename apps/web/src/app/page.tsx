import { headers } from "next/headers";
import { getCurrentUserIdFromHeaders } from "@/lib/auth";
import { getGpxFilesList, gpxRecordToDisplay, type GpxFileRecordForDisplay } from "@/lib/gpx";
import { getActiveEnrichmentJobIdsForRecordIds } from "@/app/api/gpx/enrichment-checkpoint";
import pb from "@/lib/pocketbase";
import { GpxView } from "@/components/gpx/GpxView";
import { LoginForm } from "@/components/auth/LoginForm";
import { LogoutButton } from "@/components/auth/LogoutButton";

const PB_URL = process.env.NEXT_PUBLIC_PB_URL ?? "";

export default async function HomePage() {
  let initialFiles: GpxFileRecordForDisplay[] = [];
  let initialError: string | undefined;
  let userId: string | null = null;

  if (!PB_URL) {
    initialError = "NEXT_PUBLIC_PB_URL is not set. Add it in apps/web/.env.local.";
  } else {
    try {
      const headersList = await headers();
      userId = await getCurrentUserIdFromHeaders(headersList);
      if (userId) {
        const raw = await getGpxFilesList(userId);
        initialFiles = raw.map(gpxRecordToDisplay);
        const recordIds = raw.map((r) => r.id);
        const activeJobByRecordId = await getActiveEnrichmentJobIdsForRecordIds(pb, recordIds, userId);
        initialFiles = initialFiles.map((f) =>
          activeJobByRecordId[f.id]
            ? { ...f, activeEnrichmentJobId: activeJobByRecordId[f.id] }
            : f
        );
      }
    } catch {
      initialFiles = [];
      initialError = "Could not load GPX files. Is PocketBase running?";
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">GPX Viewer</h1>
        {userId ? <LogoutButton /> : null}
      </div>
      {initialError ? (
        <div className="rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          {initialError}
        </div>
      ) : userId ? (
        <GpxView
          initialFiles={initialFiles}
          initialError={initialError}
        />
      ) : (
        <div className="flex min-h-[calc(100vh-6rem)] flex-col items-center justify-center py-12">
          <LoginForm />
        </div>
      )}
    </div>
  );
}
