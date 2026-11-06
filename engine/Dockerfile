# ─────────────────────────────────────────────────────────────────────
#  Engine image — document extraction + conversation search.
#
#  TWO STAGES, and the reason is the binary. A cargo build needs the full
#  toolchain (~1.5GB) while the artifact is a single static-ish binary
#  (~15MB). Shipping the builder would be a 100× oversized image for no
#  reason, so the runtime stage copies just the executable.
#
#  NO SECRETS IN ANY BUILD ARG OR ENV. ENGINE_TOKEN is read at runtime
#  from the environment (src/server.rs fails closed without it), so a
#  rebuilt image is safe to publish even though this repo is public.
#
#  LTO IS ENABLED HERE AND ONLY HERE. `lto = "thin"` + `codegen-units = 1`
#  in the workspace profile makes a local release build eat several GB of
#  temp space; in Docker that is the container's own layer, so the cost is
#  contained and the shipped binary is meaningfully smaller.
# ─────────────────────────────────────────────────────────────────────

# ── builder ──────────────────────────────────────────────────────────
FROM rust:1.99-slim-bookworm AS builder

# `pkg-config` and `libssl-dev` are needed by the TLS stack that tantivy's
# and axum's dependency trees pull in. Omitting them fails deep inside a
# transitive build with an unhelpful error.
RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Dependency layer first. Copying only the manifests means editing our own
# source does not invalidate the (slow) dependency compile.
#
# CACHE MOUNTS ARE LOAD-BEARING, NOT AN OPTIMISATION. A layer cache is keyed
# on its parents' digests, so the day Docker Hub re-pushes the
# `rust:1.99-slim-bookworm` tag with a new digest, every layer below it —
# including this three-to-eight-minute tantivy/axum/pdf-extract compile —
# is invalidated and rebuilt from zero. That happened on the 2026-11-06
# deploy: 492s of a 11m28s run, against 3m37s two days earlier with every
# stage CACHED. A cache mount is keyed by mount id, not by layer ancestry,
# so it survives the base image moving underneath it, and cargo's own
# fingerprints skip every crate whose inputs did not change.
#
# `sharing=locked` serialises concurrent builds on the same target dir
# rather than letting two cargo processes corrupt each other's locks — the
# runner deploys one at a time, but a manual `docker compose build` on the
# box runs beside it and must not race.
COPY Cargo.toml Cargo.lock ./
COPY engine/Cargo.toml engine/Cargo.toml
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    mkdir -p engine/src \
 && echo 'fn main() {}' > engine/src/main.rs \
 && echo '' > engine/src/lib.rs \
 && cargo build --release -p zaino-engine \
 && rm -rf engine/src

# Now the real source. Only this layer is rebuilt on a code change.
COPY engine/src engine/src
COPY engine/tests engine/tests
# Same mounts, so the dependency artifacts above are reused and only this
# crate is recompiled. `touch` defeats a stale-mtime cache hit that would
# otherwise reuse the stub binary from the dependency layer.
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    touch engine/src/main.rs engine/src/lib.rs \
 && cargo build --release -p zaino-engine \
 && cp /build/target/release/zaino-engine /build/zaino-engine

# `target/` is a cache mount, whose contents are never committed to a layer,
# so the binary has to be lifted out above before the runtime stage can see
# it. Copying from `/build/zaino-engine` rather than `/build/target/...` is
# what makes this file work with the mounts — the old path silently resolves
# inside the mount during the build and is gone in the next stage.

# ── runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runner

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Unprivileged: this service parses untrusted documents, so it is the last
# process that should run as root.
RUN useradd --system --uid 10001 --create-home --home-dir /home/engine engine

COPY --from=builder /build/zaino-engine /usr/local/bin/zaino-engine

# Owned by the service user so the tantivy index can be created on first
# boot; a read-only mount here would fail the writer every request.
RUN mkdir -p /var/lib/zaino-engine/index \
 && chown -R engine:engine /var/lib/zaino-engine

USER engine
WORKDIR /home/engine

ENV ENGINE_PORT=8099 \
    ENGINE_INDEX_DIR=/var/lib/zaino-engine/index \
    RUST_LOG=zaino_engine=info,tower_http=warn

EXPOSE 8099

# No `HEALTHCHECK` instruction on purpose: the health route needs no auth,
# but baking a curl dependency into a slim image just to self-report is
# weight. Compose declares the check instead (docker-compose.yml).
ENTRYPOINT ["/usr/local/bin/zaino-engine"]
