# predIQ — multi-stage build for production deployment.
#
# Layout:
#   stage 1 (frontend-build) — installs the Vite frontend deps and builds
#                              static assets to /app/frontend-vite/dist.
#   stage 2 (server-deps)    — installs server prod deps + generates the
#                              Prisma client. Cached separately from app code.
#   stage 3 (runtime)        — small node:alpine with just the prod deps,
#                              built frontend assets, and server source.
#
# Why multi-stage: keeps the final image small and free of npm/build tools.
# Why pin Node 20 LTS: stable, supported until April 2026 (TBD: bump to 22 LTS).
#
# Build:   docker build -t prediq .
# Run:     docker run --rm -p 3000:3000 --env-file .env prediq
# Compose: docker compose up --build (uses docker-compose.yml — adds Postgres)

# ---------- 1. Frontend build ----------
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend-vite

# Install deps with cached layer when package files don't change.
COPY frontend-vite/package*.json ./
RUN npm ci --no-audit --no-fund

COPY frontend-vite/ ./
RUN npm run build

# ---------- 2. Server prod deps + Prisma client ----------
FROM node:20-alpine AS server-deps
WORKDIR /app

# Prisma's binary engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
# Use the Postgres schema for the production image (replaces the
# SQLite-targeted schema.prisma that's preferred for local dev). See
# prisma/schema.postgres.prisma for why this is a separate file.
RUN cp prisma/schema.postgres.prisma prisma/schema.prisma \
    && npm ci --omit=dev --no-audit --no-fund \
    && npx prisma generate

# ---------- 3. Runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# Same OpenSSL requirement at runtime for Prisma queries.
RUN apk add --no-cache openssl tini \
    && addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production
ENV PORT=3000

# Copy in prebuilt deps + Prisma client.
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/prisma ./prisma
COPY --from=server-deps /app/package*.json ./

# Server source.
COPY server ./server

# Built frontend assets — server/index.js mounts these at /.
COPY --from=frontend-build /app/frontend-vite/dist ./frontend-vite/dist

# Schema is synced with `prisma db push --skip-generate` on every start —
# idempotent, and fails closed if a destructive change is detected (we want
# explicit migration files for that). Once you have proper Postgres
# migrations under prisma/migrations/, swap this for `migrate deploy`.
# Wrap in tini so SIGTERM/SIGINT propagate cleanly.
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma db push --skip-generate && node server/index.js"]
