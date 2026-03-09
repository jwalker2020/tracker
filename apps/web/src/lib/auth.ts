/**
 * Server-side auth helpers for multi-user isolation.
 * Primary path: PocketBase auth cookie (set by client after login). Server reads it from request headers.
 * Optional dev fallback: GUEST_USER_ID env when no cookie (do not rely on this for normal use).
 */

import PocketBase from "pocketbase";
import { getPocketBaseUrl } from "@/lib/pocketbase";

/** Headers-like object for cookie extraction (e.g. Request.headers or next/headers()). */
type HeadersLike = { get(name: string): string | null };

function parseUserIdFromCookie(cookieHeader: string): Promise<string | null> {
  let url: string;
  try {
    url = getPocketBaseUrl();
  } catch {
    return Promise.resolve(null);
  }
  const pb = new PocketBase(url);
  pb.authStore.loadFromCookie(cookieHeader);
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
 * Real auth: from PocketBase auth cookie (set by client after login).
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
