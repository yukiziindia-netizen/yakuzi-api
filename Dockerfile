# yakuzi-api (NestJS) -- production Dockerfile
# Build:  docker build -t yakuzi-api:dev .
# Run:    docker run --env-file .env -p 3000:3000 yakuzi-api:dev
#
# Multi-stage:
#   1. deps     -- install ALL deps (incl. dev) for build
#   2. builder  -- prisma generate + nest build, then prune to prod deps
#   3. runtime  -- minimal: node + dist + prod node_modules

# ─── Stage 1: deps ───────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# OpenSSL needed by Prisma 6 on Alpine
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json* pnpm-lock.yaml* ./

# Use npm (lockfile is package-lock.json per repo). Switch to pnpm if they migrate.
RUN if [ -f package-lock.json ]; then npm ci --include=dev; \
    elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm && pnpm install --frozen-lockfile; \
    else npm install; fi

# ─── Stage 2: builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (needs DATABASE_URL placeholder; real one is injected at runtime)
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
RUN npx prisma generate

# NestJS build -> dist/
RUN npm run build

# Prune dev deps for runtime image
RUN npm prune --omit=dev && npm cache clean --force

# ─── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat dumb-init \
    && addgroup -S nestjs -g 1001 \
    && adduser -S nestjs -u 1001 -G nestjs

ENV NODE_ENV=production
ENV PORT=3000

# Copy built app + prod deps + prisma client + migrations
COPY --from=builder --chown=nestjs:nestjs /app/dist           ./dist
COPY --from=builder --chown=nestjs:nestjs /app/node_modules   ./node_modules
COPY --from=builder --chown=nestjs:nestjs /app/package.json   ./package.json
COPY --from=builder --chown=nestjs:nestjs /app/prisma         ./prisma

USER nestjs
EXPOSE 3000

# dumb-init reaps zombies; main entry is dist/src/main.js (matches start:prod script)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main"]

# Healthcheck: NestJS app should expose /health (add @nestjs/terminus if not already)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
