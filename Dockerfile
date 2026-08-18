# syntax=docker/dockerfile:1.7
#
# Production image. Multi-stage, non-root, standalone output.
# Reasoning for every line: docs/05-infrastructure.md §5.

# ── deps: install with a warm, cacheable layer ─────────────────
FROM node:22-alpine AS deps
WORKDIR /app
# Prisma's engines are glibc-linked; libc6-compat provides the shim on Alpine.
RUN apk add --no-cache libc6-compat
# Copied BEFORE the source so dependencies re-install only when the lockfile
# changes, not on every edit to a component.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci

# ── builder ────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* is INLINED INTO THE BUNDLE at build time, so it cannot be
# supplied at runtime like the others — it must be a build arg:
#
#   docker build --build-arg NEXT_PUBLIC_APP_URL=https://portal.example.com .
#
# Getting this wrong ships the placeholder to production, where it silently
# breaks every absolute URL the client builds.
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# The build imports src/lib/env.ts, which validates at module load. The rest are
# placeholders that satisfy the schema; the real values arrive at RUNTIME.
# Baking real secrets into an image layer is how they leak.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder-at-least-32-chars" \
    AUTH_GITHUB_ID="build" \
    AUTH_GITHUB_SECRET="build" \
    S3_ENDPOINT="http://localhost:9000" \
    S3_BUCKET="build" \
    S3_ACCESS_KEY_ID="build" \
    S3_SECRET_ACCESS_KEY="build" \
    DOWNLOAD_IP_SALT="build-time-placeholder-salt"
RUN npx prisma generate
RUN npm run build

# ── runner: minimal, non-root ──────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# A container escape starts unprivileged. This is the most commonly skipped
# Docker practice and the first thing a reviewer checks.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder /app/public                                 ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone  ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static      ./.next/static
# Shipped so `prisma migrate deploy` can run from this image on release.
COPY --from=builder --chown=nextjs:nodejs /app/prisma            ./prisma
COPY --from=builder /app/node_modules/.prisma/client            ./node_modules/.prisma/client
COPY --from=builder /app/node_modules/@prisma/client            ./node_modules/@prisma/client

USER nextjs
EXPOSE 3000

# Lets an orchestrator tell "running" from "working". Uses the SHALLOW health
# check: a container whose database is down should fail readiness, not liveness
# — restarting it would not fix the database.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
