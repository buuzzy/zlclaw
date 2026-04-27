# Sage API — Railway Deployment
# Build context: project root (needs pnpm workspace files)

# ── Stage 1: Build bundle.cjs ─────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ patches/

# Copy sage-api package
COPY src-api/package.json src-api/package.json
COPY src-api/stubs/ src-api/stubs/
COPY src-api/scripts/ src-api/scripts/
COPY src-api/src/ src-api/src/
COPY src-api/tsconfig.json src-api/tsconfig.json

# Install dependencies
RUN pnpm install --frozen-lockfile --filter sage-api...

# Build bundle
RUN cd src-api && pnpm bundle

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /build/src-api/dist/bundle.cjs dist/bundle.cjs
COPY src-api/resources/ resources/

ENV NODE_ENV=production

# Railway injects PORT automatically
EXPOSE 2026

CMD ["node", "dist/bundle.cjs"]
