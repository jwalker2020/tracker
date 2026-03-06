import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">Full-Stack Cursor Starter</h1>
      <p className="mt-4 text-gray-700">
        This starter is ready for Next.js + PocketBase development.
      </p>

      <div className="mt-6 space-y-2">
        <div><Link className="text-blue-600 underline" href="/month/2026-03">Example month route</Link></div>
        <div><Link className="text-blue-600 underline" href="/day/2026-03-05">Example day route</Link></div>
      </div>
    </main>
  );
}
