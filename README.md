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

## GPX Viewer

The **GPX Viewer** at `/gpx` lets you upload GPX files, store them in PocketBase, and view one or more tracks on a Leaflet map (OpenStreetMap or USGS Topo).

### PocketBase collection for GPX

In the PocketBase admin (e.g. http://localhost:8090/_/), create a collection **`gpx_files`** with these fields:

| Field        | Type   | Notes                    |
| ------------ | ------ | ------------------------ |
| `name`       | Text   | Display name             |
| `file`       | File   | Single file (.gpx)       |
| `uploadedBy` | Text   | Optional                  |
| `boundsJson` | Text   | JSON bounds              |
| `centerLat`  | Number |                          |
| `centerLng`  | Number |                          |
| `trackCount` | Number |                          |
| `pointCount` | Number |                          |
| `color`      | Text   | Hex color for the track  |
| `sortOrder`  | Number | Optional; set by migrations. Used for persistent list order. |

The app fills these on upload. Run `./pocketbase migrate up` from `apps/pb` so migrations add `sortOrder` and allow updates; the GPX list order is then stored in the database.
