import { NextResponse } from "next/server";
import PocketBase from "pocketbase";
import { getPocketBaseUrl } from "@/lib/pocketbase";

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Authenticates with PocketBase and sets the auth cookie via Set-Cookie so the browser
 * sends it on all same-origin requests. Use this instead of client-side cookie setting
 * to avoid SameSite/domain issues (e.g. LAN IP, HTTP).
 */
export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  let pb: PocketBase;
  try {
    pb = new PocketBase(getPocketBaseUrl());
  } catch {
    return NextResponse.json(
      { error: "Server misconfiguration (PocketBase URL)" },
      { status: 500 }
    );
  }

  try {
    await pb.collection("users").authWithPassword(email, password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes("invalid") || lower.includes("failed to authenticate")) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    if (lower.includes("verified") || lower.includes("verification")) {
      return NextResponse.json(
        { error: "Email not verified. In PocketBase Admin, turn on the “verified” checkbox for the user." },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: msg || "Login failed." }, { status: 401 });
  }

  // Server sets the cookie so the browser stores it and sends it on every request.
  const cookieStr = pb.authStore.exportToCookie({ httpOnly: false, path: "/", secure: false });
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookieStr);
  return res;
}
