# App image: Next.js web + enrichment worker (same image, different command).
# Build from repo root so pnpm workspace can resolve apps/web.

FROM node:20-alpine AS base
RUN corepack enable pnpm

# Install dependencies (include devDependencies so worker can run with tsx).
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install

# Build Next.js app. NEXT_PUBLIC_* are inlined at build time, so set them here.
FROM base AS builder
ARG NEXT_PUBLIC_PB_URL=http://pocketbase:8090
ENV NEXT_PUBLIC_PB_URL=$NEXT_PUBLIC_PB_URL
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/web/node_modules /app/apps/web/node_modules
COPY . .
RUN pnpm --filter web build

# Production image: run web (next start) or worker (node + tsx).
# Keep workspace layout so pnpm symlinks in apps/web/node_modules resolve.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/
COPY --from=builder /app/apps/web /app/apps/web
WORKDIR /app/apps/web
EXPOSE 3000

# Default: run web. Override in compose to run worker.
CMD ["pnpm", "start"]
