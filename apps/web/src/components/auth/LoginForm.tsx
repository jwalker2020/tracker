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
  const [showHelp, setShowHelp] = useState(false);

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
      window.location.href = "/";
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach server. Is the app running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-900/80 p-8 shadow-2xl shadow-black/40 backdrop-blur-sm">
      {/* Accent bar */}
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-sky-500 to-emerald-500" aria-hidden />

      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-100">
          Welcome back
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          Sign in to access your GPX tracks
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-slate-300"
          >
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className="w-full rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-3 text-slate-100 placeholder-slate-500 transition-colors focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-slate-300"
          >
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="w-full rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-3 text-slate-100 placeholder-slate-500 transition-colors focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          />
        </div>

        {error ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-200"
            role="alert"
          >
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-colors hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-60"
        >
          {loading ? (
            <span className="inline-flex items-center justify-center gap-2">
              <svg
                className="h-4 w-4 animate-spin text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <circle
                  className="opacity-30"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-90"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Signing in…
            </span>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <div className="mt-6 border-t border-slate-700/80 pt-4">
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-slate-800/50 hover:text-slate-300"
          aria-expanded={showHelp}
        >
          <span>First time? Create a user in PocketBase</span>
          <svg
            className={`h-4 w-4 shrink-0 transition-transform ${showHelp ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showHelp && (
          <div className="mt-2 rounded-lg bg-slate-800/50 px-4 py-3 text-sm text-slate-400">
            In PocketBase Admin: <strong className="text-slate-300">Collections</strong> → open{" "}
            <strong className="text-slate-300">users</strong> →{" "}
            <strong className="text-slate-300">New record</strong>. Set email and password, turn{" "}
            <strong className="text-slate-300">verified</strong> on, then save. Use that email and
            password here.
          </div>
        )}
      </div>
    </div>
  );
}
