#!/bin/sh
set -e

echo "[PB] Running migrations..."
/app/pocketbase migrate up

echo "[PB] Migrations complete"
echo "[PB] Starting PocketBase server..."
exec /app/pocketbase serve --http=0.0.0.0:8090
