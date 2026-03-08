import PocketBase from "pocketbase";

function getPocketBaseUrl() {
  const url = process.env.NEXT_PUBLIC_PB_URL;

  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_PB_URL environment variable. Set it in apps/web/.env.local."
    );
  }

  return url;
}

const pocketBaseClient = new PocketBase(getPocketBaseUrl());

// Allow background requests (e.g. checkpoint saves after POST /api/gpx/enrich returns)
// to complete; otherwise the SDK cancels in-flight requests when the HTTP response is sent.
pocketBaseClient.autoCancellation(false);

export default pocketBaseClient;
