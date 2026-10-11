# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────
#  Portal image.
#
#  TWO TARGETS, ON PURPOSE.
#
#  runner  Next.js `output: 'standalone'` — a traced subset of node_modules
#          containing only what the server bundle actually imports. Small,
#          and it is what serves HTTP.
#
#  jobs    A different consumer with different needs: the job runner
#          (scripts/jobs.ts) imports db/, lib/ and scripts/ directly and
#          needs the real dependency tree. Standalone's traced output does
#          not contain it, so it gets its own stage instead of a
#          Frankenstein image with two node_modules stapled together.
#
#  NO SECRETS IN ANY BUILD ARG OR ENV HERE. Every credential is read at
#  RUNTIME from the environment, so a rebuilt image is safe to publish even
#  though this repository is public (MASTER_PROMPT §7).
# ─────────────────────────────────────────────────────────────────────

# ── deps ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── runner: the HTTP server ──────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root (IMPLEMENTATION.md §5.1). Explicit uid/gid so bind-mounted
# volumes are predictable regardless of what the base image ships.
RUN addgroup -S -g 1001 nextjs && adduser -S -u 1001 -G nextjs nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

# ── jobs: the background runner ──────────────────────────────────────
FROM node:22-alpine AS jobs
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Source only — no Next.js, no .next, no tests. The runner never imports
# app code, so shipping it would be dead weight in the image.
COPY db ./db
COPY lib ./lib
COPY scripts ./scripts
COPY tsconfig.json ./

USER node
# --experimental-transform-types is required, not --experimental-strip-types:
# lib/litellm/client.ts and lib/auth/authorize.ts use TS parameter
# properties, which type-stripping refuses (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
CMD ["node", "--experimental-transform-types", \
     "--import", "./scripts/register-ts-resolve.mjs", \
     "scripts/jobs.ts", "loop"]
