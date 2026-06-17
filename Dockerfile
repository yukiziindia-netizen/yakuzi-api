# yakuzi-api (NestJS) -- production Dockerfile
# Multi-stage build using pnpm

# ─── Stage 1: deps ───────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN echo "node-linker=hoisted" > .npmrc
RUN pnpm install --frozen-lockfile

# ─── Stage 2: builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
RUN npx prisma@6.19.2 generate

# Build NestJS
RUN pnpm run build

# ─── Stage 3: prod-deps ──────────────────────────────────────────────────────
# Install ONLY production dependencies in a clean layer to avoid pruning issues
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN echo "node-linker=hoisted" > .npmrc
RUN pnpm install --prod --frozen-lockfile

# Re-generate Prisma in prod-deps so the production node_modules has the Prisma Client
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
RUN npx prisma@6.19.2 generate

# ─── Stage 4: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat dumb-init \
    && addgroup -S nestjs -g 1001 \
    && adduser -S nestjs -u 1001 -G nestjs

ENV NODE_ENV=production
ENV PORT=3000

# Copy built app + pristine prod deps
COPY --from=builder --chown=nestjs:nestjs /app/dist           ./dist
COPY --from=prod-deps --chown=nestjs:nestjs /app/node_modules   ./node_modules
COPY --from=prod-deps --chown=nestjs:nestjs /app/package.json   ./package.json
COPY --from=prod-deps --chown=nestjs:nestjs /app/prisma         ./prisma

USER nestjs
EXPOSE 3000

# dumb-init reaps zombies; main entry is dist/src/main.js
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main"]

# Healthcheck targeting the NestJS health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
