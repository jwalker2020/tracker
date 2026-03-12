"use client";

import { useRouter } from "next/navigation";

/**
 * Calls the logout API to clear the auth cookie, then refreshes so the server sees unauthenticated state.
 * No direct PocketBase access from the browser.
 */
export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
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
