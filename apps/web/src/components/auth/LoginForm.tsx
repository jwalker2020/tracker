"use client";

import { useState } from "react";

/**
 * Login via server route so the auth cookie is set by Set-Cookie (avoids client cookie issues
 * on LAN IP, HTTP, or strict browsers).
 */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? `Login failed (${res.status}).`);
        return;
      }
      window.location.href = "/gpx";
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach server. Is the app running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Log in</h2>
      <p className="mb-4 text-sm text-slate-400">
        In PocketBase Admin: <strong>Collections</strong> → open <strong>users</strong> → <strong>New record</strong>. Set email and password, turn <strong>verified</strong> on, then save. Use that email and password here.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="mb-1 block text-xs font-medium text-slate-300">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200"
          />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-1 block text-xs font-medium text-slate-300">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200"
          />
        </div>
        {error ? (
          <div
            className="rounded border border-red-800/60 bg-red-950/40 px-3 py-2 text-sm text-red-200"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
