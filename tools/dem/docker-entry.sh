#!/usr/bin/env bash
set -e

RAW_DIR="${DEM_RAW_DIR:-/workspace/raw}"
OUTPUT_DIR="${DEM_OUTPUT_DIR:-/workspace/output}"

sub="${1:-all}"

run_download() {
  echo "[DEM tools] Downloading to ${RAW_DIR} (skip existing)..."
  mkdir -p "${RAW_DIR}"
  pnpm run download -- --output "${RAW_DIR}" --source usgs-nh --no-manifest
}

run_process() {
  echo "[DEM tools] Processing: ${RAW_DIR} -> ${OUTPUT_DIR} (decompress for geotiff.js)..."
  mkdir -p "${OUTPUT_DIR}"
  count=0
  for f in "${RAW_DIR}"/*.tif "${RAW_DIR}"/*.tiff; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    out="${OUTPUT_DIR}/${base}"
    if [ -f "$out" ]; then
      echo "  skip (exists): $base"
    else
      echo "  process: $base"
      gdal_translate -q -co COMPRESS=NONE -co TILED=YES "$f" "$out"
      count=$((count + 1))
    fi
  done
  echo "[DEM tools] Processed ${count} new tile(s)."
}

run_manifest() {
  echo "[DEM tools] Generating manifest.json in ${OUTPUT_DIR}..."
  if [ ! -d "${OUTPUT_DIR}" ]; then
    echo "Error: output dir not found: ${OUTPUT_DIR}. Run download and process first." >&2
    exit 1
  fi
  pnpm run manifest -- --input "${OUTPUT_DIR}" --output "${OUTPUT_DIR}/manifest.json"
  echo "[DEM tools] Done. Tiles and manifest in ${OUTPUT_DIR}"
}

case "$sub" in
  download)
    run_download
    ;;
  process)
    run_process
    ;;
  manifest)
    run_manifest
    ;;
  all)
    run_download
    run_process
    run_manifest
    ;;
  *)
    echo "Usage: $0 {all|download|process|manifest}" >&2
    echo "  all      (default) download -> process -> manifest" >&2
    echo "  download fetch DEM tiles to raw dir (idempotent)" >&2
    echo "  process  decompress raw tiles to output dir (idempotent)" >&2
    echo "  manifest generate manifest.json from output dir" >&2
    echo "" >&2
    echo "Mounts: -v <host>/raw:${RAW_DIR} -v <host>/output:${OUTPUT_DIR}" >&2
    echo "Or set DEM_RAW_DIR / DEM_OUTPUT_DIR." >&2
    exit 1
    ;;
esac
