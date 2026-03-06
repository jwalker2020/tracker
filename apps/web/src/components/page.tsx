import type { ReactNode } from "react";

type PageProps = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export function Page({ title, description, children }: PageProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-gray-600">{description}</p>
        ) : null}
      </header>
      {children ? <section className="space-y-4">{children}</section> : null}
    </main>
  );
}
