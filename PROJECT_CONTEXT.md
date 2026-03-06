# Project Context

## Stack
- Next.js 16
- React
- TypeScript
- App Router
- Tailwind CSS
- PocketBase
- date-fns
- zod
- pnpm workspace

## Architecture
- `apps/web` = Next.js frontend
- `apps/pb` = PocketBase backend
- `src/lib/*` = data access and helpers
- `src/components/*` = reusable UI

## Rules
- Use App Router only
- Do not use `next/router`
- In Next.js 16, dynamic route params are async (e.g. `params: Promise<{ slug: string }>`, then `await params`)
- Prefer server components
- Keep styling in Tailwind
- Keep TypeScript strict
- Avoid unrelated refactors
