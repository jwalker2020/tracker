# DEM tooling: one-shot utility to download, process, and generate manifest.
# Not a long-running service. Run with: docker run --rm -v ... dem-tools [all|download|process|manifest]

FROM node:20-bookworm-slim

# GDAL for gdal_translate (decompress GeoTIFFs so geotiff.js can read them reliably)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm

WORKDIR /app

COPY package.json ./
RUN pnpm install

COPY src ./src
COPY tsconfig.json ./
COPY docker-entry.sh /docker-entry.sh
RUN chmod +x /docker-entry.sh

# Default: run full pipeline. Override with: docker run ... dem-tools download
ENTRYPOINT ["/docker-entry.sh"]
CMD ["all"]
