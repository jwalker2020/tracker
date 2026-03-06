# Cursor Project Rules

## Hard rules
- Use Next.js App Router only
- Do not use `next/router`
- Dynamic route params are async in Next.js 16
- Prefer server components
- Use `next/link` for navigation
- Keep styling in Tailwind
- Modify only requested files
- Do not add unnecessary dependencies

## Data rules
- Keep PocketBase access in `src/lib/*`
- Prefer small helpers like `getRecordsInRange()`
