#!/usr/bin/env bash
# Apply migrations to create the gpx_files collection (and any other pending migrations).
# Run from repo root: ./apps/pb/scripts/create-gpx-collection.sh
# Or from apps/pb: ./scripts/create-gpx-collection.sh

set -e
cd "$(dirname "$0")/.."
BIN="$(pwd)/pocketbase"

if [[ ! -x "$BIN" ]]; then
  echo "PocketBase binary not found or not executable: $BIN" >&2
  echo "Place the pocketbase binary in apps/pb/ then run again." >&2
  exit 1
fi

"$BIN" migrate up
echo "Migrations applied. Start the server with: $BIN serve"
