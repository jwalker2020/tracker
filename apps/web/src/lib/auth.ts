/**
 * Server-side auth helpers for multi-user isolation.
 * Primary path: PocketBase auth cookie set by server (Set-Cookie from POST /api/auth/login). Server reads it from the request Cookie header.
 * Optional dev fallback only: GUEST_USER_ID env when no cookie (do not rely on this for normal use).
 */

import PocketBase from "pocketbase";
import { getPocketBaseUrl } from "@/lib/pocketbase";

/** Headers-like object for cookie extraction (e.g. Request.headers or next/headers()). */
type HeadersLike = { get(name: string): string | null };

/** Extract pb_auth from Cookie header (default key used by exportToCookie). */
function getPbAuthFromCookieHeader(cookieHeader: string): string {
  const key = "pb_auth=";
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(key)) return part;
  }
  return "";
}

function parseUserIdFromCookie(cookieHeader: string): Promise<string | null> {
  let url: string;
  try {
    url = getPocketBaseUrl();
  } catch {
    return Promise.resolve(null);
  }
  const pb = new PocketBase(url);
  const pbAuth = getPbAuthFromCookieHeader(cookieHeader);
  pb.authStore.loadFromCookie(pbAuth || cookieHeader);
  return Promise.resolve(pb.authStore.model?.id ?? null);
}

/**
 * Returns the current user's id from request headers (cookie), else null.
 * Use in API route handlers: getCurrentUserId(request).
 */
export async function getCurrentUserId(request: Request): Promise<string | null> {
  return getCurrentUserIdFromHeaders(request.headers);
}

/**
 * Returns the current user's id from a headers-like object (e.g. next/headers() in server components).
 * Real auth: from PocketBase auth cookie (set by server on login).
 * Optional dev fallback only: when no cookie, GUEST_USER_ID env (single shared user); not for production reliance.
 */
export async function getCurrentUserIdFromHeaders(headers: HeadersLike): Promise<string | null> {
  const cookie = headers.get("cookie") ?? "";
  const fromCookie = await parseUserIdFromCookie(cookie);
  if (fromCookie) return fromCookie;
  // Optional dev fallback: do not rely on this for normal use; real auth is cookie-based.
  const guestId = process.env.GUEST_USER_ID?.trim();
  return guestId || null;
}
