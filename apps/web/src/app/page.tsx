import Link from "next/link";
import { Page } from "@/components/page";

export default function HomePage() {
  return (
    <Page
      title="Full-Stack Cursor Starter"
      description="Next.js 16 + PocketBase + Tailwind CSS, wired for pnpm workspaces."
    >
      <div className="space-y-4">
        <p className="text-gray-300">
          This starter is ready for production-focused full-stack development in
          Cursor.
        </p>

        <p className="text-sm text-slate-300">
          <Link
            href="/gpx"
            className="font-medium text-sky-400 underline underline-offset-4"
          >
            GPX Viewer
          </Link>{" "}
          – upload and view GPX tracks on a map.
        </p>

        <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-medium text-slate-100">Getting started</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-200">
            <li>
              Install dependencies with{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                pnpm install
              </code>
              .
            </li>
            <li>
              Place your PocketBase binary in{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                apps/pb/
              </code>{" "}
              and run{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                ./pocketbase serve
              </code>
              .
            </li>
            <li>
              Create{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                apps/web/.env.local
              </code>{" "}
              with{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                NEXT_PUBLIC_PB_URL=http://localhost:8090
              </code>
              .
            </li>
            <li>
              Start the frontend with{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                pnpm dev
              </code>
              .
            </li>
          </ol>
        </section>

        <section className="space-y-2 text-sm text-slate-200">
          <h2 className="text-sm font-medium text-slate-100">Project layout</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                apps/web/src/app
              </code>{" "}
              – Next.js App Router entrypoints.
            </li>
            <li>
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                apps/web/src/components
              </code>{" "}
              – shared React components.
            </li>
            <li>
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
                apps/web/src/lib
              </code>{" "}
              – PocketBase client and data helpers.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm text-slate-200">
          <h2 className="text-sm font-medium text-slate-100">Next steps</h2>
          <p>
            Add routes under{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
              src/app
            </code>{" "}
            using server components by default, and create small helpers in{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.8rem]">
              src/lib
            </code>{" "}
            to query PocketBase.
          </p>
          <p>
            For navigation, use{" "}
            <Link
              href="/"
              className="font-medium text-sky-400 underline underline-offset-4"
            >
              next/link
            </Link>{" "}
            rather than <code>next/router</code>.
          </p>
        </section>
      </div>
    </Page>
  );
}
