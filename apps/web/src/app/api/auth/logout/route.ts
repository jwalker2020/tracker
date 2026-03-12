import { NextResponse } from "next/server";

/**
 * POST /api/auth/logout
 * Clears the PocketBase auth cookie so the server sees unauthenticated state on subsequent requests.
 * Browser calls this instead of using the PocketBase SDK directly (keeps PocketBase internal-only).
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Match login cookie path so the browser clears it reliably (login sets path: "/", no HttpOnly).
  res.headers.set("Set-Cookie", "pb_auth=; Path=/; Max-Age=0");
  return res;
}
