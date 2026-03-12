#!/usr/bin/env bash
# Run DEM tooling container from tracker root. Usage: pnpm dem:docker [all|download|process|manifest]
# Always run from tracker: pnpm dem:docker   (uses ./dem-data/raw and ./dem-data/output)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

CMD="${1:-all}"
BASE="${DEM_DATA_DIR:-$ROOT/dem-data}"
# Ensure absolute paths for Docker mounts (so they work regardless of cwd)
case "$BASE" in /*) ;; *) BASE="$ROOT/$BASE";; esac
RAW="$BASE/raw"
OUT="$BASE/output"

echo "DEM tooling (tracker: $ROOT)"
echo "  raw:    $RAW"
echo "  output: $OUT"
echo "  command: $CMD"
echo ""

mkdir -p "$RAW" "$OUT"

docker build -t dem-tools -f tools/dem/Dockerfile tools/dem
docker run --rm \
  -v "$RAW:/workspace/raw" \
  -v "$OUT:/workspace/output" \
  dem-tools "$CMD"
