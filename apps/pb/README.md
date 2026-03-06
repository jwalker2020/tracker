Place the PocketBase binary for your platform in this folder (`apps/pb/`), then run:

```bash
./pocketbase serve
```

By default, PocketBase will:

- Listen on `http://localhost:8090`
- Store data in `pb_data/`

### Creating the `gpx_files` collection

The schema for the GPX viewer is defined in **JavaScript migrations** under `pb_migrations/`. To create the `gpx_files` collection (and apply any other pending migrations), either:

1. **Start the server** – migrations run automatically on `serve`:
   ```bash
   ./pocketbase serve
   ```

2. **Apply migrations only** (no server):
   ```bash
   ./pocketbase migrate up
   ```
   Or from repo root:
   ```bash
   cd apps/pb && ./pocketbase migrate up
   ```

The migration `pb_migrations/1730000000_create_gpx_files_collection.js` creates the `gpx_files` collection with fields: `name`, `file`, `uploadedBy`, `boundsJson`, `centerLat`, `centerLng`, `trackCount`, `pointCount`, `color`.

**Important:** After running `migrate up`, you must **restart PocketBase** (`./pocketbase serve`) so the new collection is loaded. Otherwise you may see "Missing or invalid collection context" when uploading.
