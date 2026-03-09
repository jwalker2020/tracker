"use client";

import { useRouter } from "next/navigation";
import pb from "@/lib/pocketbase";

/**
 * Clears PocketBase auth and the auth cookie, then refreshes so the server sees unauthenticated state.
 */
export function LogoutButton() {
  const router = useRouter();

  function handleLogout() {
    pb.authStore.clear();
    // Remove auth cookie so server no longer sees a user.
    document.cookie = "pb_auth=; Max-Age=0; path=/";
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-600"
    >
      Log out
    </button>
  );
}
