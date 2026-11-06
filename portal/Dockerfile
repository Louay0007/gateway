
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
# npm's own download cache lives in a cache mount, so a dependency bump that
# misses the layer cache still does not re-download every tarball. With
# `sharing=locked` two concurrent builds on the box cannot corrupt it.
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

# ── builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# db/index.ts validates DATABASE_URL at MODULE EVALUATION time and throws
# if it is absent, and Next's page-data collection imports the route
# graph during the build. Every page that touches the database is
# `force-dynamic`, so nothing is actually queried here — but without a
# value the build dies at "/api/auth/[...nextauth]".
#
# This placeholder is a build-time constant, never a secret, and it never
# opens a connection: the postgres client constructs its pool lazily.
# Credentials are deliberately omitted — a DSN carrying a literal password
# is the shape scripts/scrub-check.sh exists to keep out of a public repo,
# and an unconnectable URL needs none to satisfy the guard below.
# If a page ever DOES query the database during the build, it fails with a
# connection error — which is the correct outcome, not something this
# value conceals.
ENV DATABASE_URL=postgresql://127.0.0.1:5432/build

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `COPY . .` above is keyed on the source tree, so every code change
# invalidates this layer — and `npm run build` was 233s of the 2026-11-06
# deploy (11m28s total). Next keeps a webpack/turbopack build cache under
# `.next/cache`; mounting it means a rebuild recompiles the modules that
# changed instead of all 411 of them. It is a cache, not an artifact: the
# runner stage copies only `.next/standalone` and `.next/static`, so
# nothing from this mount can leak into the shipped image.
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked npm run build

# ── runner: the HTTP server ──────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root. Explicit uid/gid so bind-mounted
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
# Same download cache as the deps stage — one tarball fetch serves both
# images, and `npm cache clean --force` is gone because it would evict the
# cache mount this line exists to populate.
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev

# Source only — no Next.js, no .next, no tests. The runner never imports
# app code, so shipping it would be dead weight in the image.
COPY db ./db
COPY lib ./lib
COPY scripts ./scripts
COPY tsconfig.json ./

# The brand mark that every email embeds. lib/email/layout.ts reads it with
# readFileSync(join(process.cwd(), 'public/logo/…')), so an image without
# this directory throws ENOENT on the FIRST mail it tries to send — which
# happens on a code path with no fallback, so the send is lost and the only
# trace is one log line. This target sends ops alerts (lib/jobs/send-alerts)
# and both D17 customer notifications (lib/billing/d17-proof), so it needs
# the file exactly as much as the portal does.
#
# 24 KB, PNG only: the runner uses <img src="cid:…"> and never references
# any other asset under public/.
COPY public/logo ./public/logo

# WHY THE RUNNER SHARES THE PORTAL'S UID. `lib/billing/d17-proof.ts`
# writes proof screenshots into D17_UPLOADS_DIR, and the runner executes
# that code path (verify-d17, and the D17 customer flows it drives). That
# directory is a bind mount owned by the PORTAL's uid, so running as the
# base image's `node` (1000) while the portal runs as `nextjs` (1001)
# produced EACCES on every proof write from this container:
#
#   Error: EACCES: permission denied, open '/app/data/d17-uploads/….png'
#
# Found on the production box. `mkdir(recursive)` cannot help — the
# directory already exists and belongs to someone else. Running both
# containers as one uid is the durable fix; chmod-ing the host directory
# only works until the next bind mount or a fresh checkout.
RUN addgroup -S -g 1001 nextjs && adduser -S -u 1001 -G nextjs nextjs
USER nextjs

# --experimental-transform-types is required, not --experimental-strip-types:
# lib/litellm/client.ts and lib/auth/authorize.ts use TS parameter
# properties, which type-stripping refuses (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
CMD ["node", "--experimental-transform-types", \
     "--import", "./scripts/register-ts-resolve.mjs", \
     "scripts/jobs.ts", "loop"]
