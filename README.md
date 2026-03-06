# Full-Stack Cursor Starter

A lightweight starter for building full-stack TypeScript apps with:

- Next.js 16
- TypeScript
- Tailwind CSS
- PocketBase
- pnpm workspace
- Cursor-friendly project rules

## Quick start

### Install dependencies

```bash
pnpm install
```

### Start PocketBase

Put the PocketBase binary in `apps/pb/`, then run:

```bash
cd apps/pb
./pocketbase serve
```

### Configure frontend

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_PB_URL=http://localhost:8090
```

### Start the app

```bash
pnpm dev
```
