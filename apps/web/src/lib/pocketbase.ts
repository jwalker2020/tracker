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

export default pocketBaseClient;
