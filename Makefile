# LLM Gateway — operations entry points.
# Full decisions. Analysis and runbook.

SHELL := /bin/bash
COMPOSE := docker compose
# The LOCAL overlay (Docker Desktop only — see docker-compose.local.yml).
# Kept separate from COMPOSE because the VPS must never load it.
COMPOSE_LOCAL := docker compose -f docker-compose.yml -f docker-compose.local.yml
LOCAL := http://127.0.0.1:4000

.DEFAULT_GOAL := help

.PHONY: help init probe up up-local down down-local restart logs ps health key \
        report reconcile smoke latency backup restore pull deploy verify-config \
        check-format verify-caddy db-init db-migrate jobs jobs-once accounts \
        health-local test-local e2e plan \
        verify-metering verify-d17 verify-dodo verify-grant backup-drill verify-engine

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# Portable in-place edit: BSD sed needs `sed -i ''`, GNU sed needs `sed -i`,
# and the VPS is GNU. `sed -i ''` on Linux treats the '' as a filename and
# leaves .env unmodified, so this writes to a temp file and moves it — the
# one form that is correct on both.
#
# The guard uses `test ! -f .env ||` rather than `test -f .env &&`: with `&&`,
# the success path ("no .env yet") leaves the shell exiting 1 and make aborts
# the target before it creates anything.
init: ## Create .env from template with generated secrets
	@test ! -f .env || { echo ".env already exists — refusing to overwrite"; exit 1; }
	@cp .env.example .env
	@sed -e "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=sk-$$(openssl rand -hex 32)|" \
	     -e "s|^LITELLM_SALT_KEY=.*|LITELLM_SALT_KEY=sk-$$(openssl rand -hex 32)|" \
	     -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$(openssl rand -hex 24)|" \
	     -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$$(openssl rand -hex 24)|" \
	     -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$$(openssl rand -base64 32)|" \
	     -e "s|^BILLING_DEV_SECRET=.*|BILLING_DEV_SECRET=$$(openssl rand -hex 24)|" \
	     .env > .env.tmp && mv .env.tmp .env
	@chmod 600 .env
	@echo ""
	@echo "  .env created with generated secrets (0600)."
	@echo "  NOW EDIT THESE — nothing works until you do:"
	@echo "    API_DOMAIN, PORTAL_DOMAIN,"
	@echo "    UPSTREAM_BASE_URL, UPSTREAM_API_KEY"
	@echo ""
	@echo "  BACK UP LITELLM_SALT_KEY AND AUTH_SECRET SEPARATELY."
	@echo "  Neither is in the database dump."
	@echo ""
	@echo "  Next: make probe"

probe: ## Detect which wire formats the upstream supports  (RUN FIRST)
	@[ -f ./.env ] && set -a && . ./.env && set +a; \
	 : "$${UPSTREAM_BASE_URL:?set UPSTREAM_BASE_URL in .env}"; \
	 ./scripts/probe-upstream.sh

up: ## Start the stack
	$(COMPOSE) up -d
	@echo "Waiting for health..."
	@sleep 5
	@$(MAKE) --no-print-directory health

# ── Docker Desktop (macOS/Windows) ─────────────────────────────────
# `make up` cannot work there: the base compose file gives caddy
# `network_mode: host`, which on Docker Desktop means the Linux VM, so
# nothing caddy binds is reachable from the browser and every URL refuses
# the connection while all containers report healthy. This target loads
# docker-compose.local.yml, which moves caddy and auth-edge to the bridge
# and points them at each other by service name.
#
# The VPS keeps `make up`. Neither target is a flag on the other, because
# a typo in one must not silently run a production box in local mode.
up-local: ## Start the stack for Docker Desktop (HTTP on :80, no TLS)
	@# Port 80 must be free: the whole point of this target is that a
	@# browser reaches caddy directly, and AirPlay Receiver on macOS
	@# holds :5000/:7000 — but Apache or another dev proxy can hold :80.
	@if lsof -nP -iTCP:80 -sTCP:LISTEN >/dev/null 2>&1; then \
	  echo "  port 80 is already in use — stop the listener first:"; \
	  lsof -nP -iTCP:80 -sTCP:LISTEN; exit 1; \
	fi
	$(COMPOSE_LOCAL) up -d
	@# Wait for a REAL signal, not a fixed sleep. LiteLLM imports its model
	@# config and opens Postgres and Redis connections on boot, which takes
	@# well past the 5s a sleep would allow — so a fixed wait reported FAIL
	@# on a stack that was merely still starting, which trains people to
	@# ignore the health output.
	@echo "Waiting for the gateway and portal to report ready..."
	@for i in $$(seq 1 60); do \
	  gw=$$(curl -sS -m 3 -o /dev/null -w '%{http_code}' $(LOCAL)/health/readiness 2>/dev/null); \
	  pt=$$(curl -sS -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health 2>/dev/null); \
	  if [ "$$gw" = "200" ] && [ "$$pt" = "200" ]; then \
	    echo "  ready in about $$((i * 2))s"; break; \
	  fi; \
	  if [ "$$i" = "60" ]; then echo "  still not ready after 60 tries — reporting actual state"; fi; \
	  sleep 2; \
	done
	@$(MAKE) --no-print-directory health-local

down-local: ## Stop the Docker Desktop stack
	$(COMPOSE_LOCAL) down

down: ## Stop the stack (volumes preserved)
	$(COMPOSE) down

restart: ## Restart the gateway
	$(COMPOSE) restart litellm caddy

logs: ## Tail logs
	$(COMPOSE) logs -f --tail=100

ps: ## Show container status
	$(COMPOSE) ps

db-init: ## Create the portal database (idempotent)
	./scripts/db-init.sh

db-migrate: ## Apply pending portal migrations (idempotent, forward-only)
	./scripts/db-migrate.sh

jobs: ## Run one pass of every due background job
	@# --no-deps is load-bearing. `docker compose run` reconciles the
	@# service's dependencies first, and `jobs` depends on litellm with
	@# `condition: service_started`, so with litellm already up this can
	@# block for minutes before running a job that takes seconds. Matches
	@# verify-d17 / verify-grant, which have always done this.
	$(COMPOSE) run --rm --no-deps jobs node --experimental-transform-types \
	  --import ./scripts/register-ts-resolve.mjs scripts/jobs.ts once

jobs-once: jobs ## Alias

# ── Local sign-in ───────────────────────────────────────────────────
# Every page in the product is behind a session, and auth is the product —
# so there is no "just disable it" version of local testing. These two
# accounts are ordinary rows created by the same function the sign-up form
# runs (lib/auth/create-user.ts), which means the scrypt hash is correct
# by construction and nothing on the auth path is bypassed or weakened.
#
# Credentials come from .env and have defaults so this works on a fresh
# clone. Re-running RESETS the password and re-activates the staff row, so
# "I forgot what I set" is a make call, not hand-written SQL against a
# password hash.
LOCAL_CUSTOMER_EMAIL ?= customer@example.test
LOCAL_STAFF_EMAIL    ?= staff@example.test
LOCAL_PASSWORD       ?= local-dev-password-1
PLAN                 ?= starter

accounts: ## Seed a customer + staff login for local testing (idempotent, resets passwords)
	@$(COMPOSE) run --rm --no-deps \
	  -e CUSTOMER_EMAIL="$(LOCAL_CUSTOMER_EMAIL)" \
	  -e CUSTOMER_PASSWORD="$(LOCAL_PASSWORD)" \
	  -e CUSTOMER_NAME="Local Customer" \
	  -e STAFF_EMAIL="$(LOCAL_STAFF_EMAIL)" \
	  -e STAFF_PASSWORD="$(LOCAL_PASSWORD)" \
	  -e STAFF_NAME="Local Staff" \
	  -e STAFF_ROLE="admin" \
	  jobs node --experimental-transform-types \
	  --import ./scripts/register-ts-resolve.mjs scripts/create-accounts.ts
	@echo ""
	@echo "  sign in at http://$$(grep '^PORTAL_DOMAIN=' .env | cut -d= -f2-)/sign-in"
	@echo "    customer  $(LOCAL_CUSTOMER_EMAIL)"
	@echo "    staff     $(LOCAL_STAFF_EMAIL)   (admin — for /admin)"
	@echo "    password  $(LOCAL_PASSWORD)"

health: ## Check gateway, portal, jobs, Postgres and pricing wiring
	@echo -n "  gateway health : "; \
	  code=$$(curl -sS -m 10 -o /dev/null -w '%{http_code}' \
	    $(LOCAL)/health/readiness 2>/dev/null); \
	  if [ "$$code" = "200" ]; then echo "OK (200) — budgets ARE enforced"; \
	  else echo "FAIL (got $$code) — check: docker compose logs litellm"; fi
	@echo -n "  postgres       : "; \
	  $(COMPOSE) exec -T postgres pg_isready -U litellm >/dev/null 2>&1 \
	    && echo "ready — budgets ARE enforced" \
	    || echo "NOT READY — budgets are silently no-op"
	@echo -n "  portal health  : "; \
	  curl -sS -m 10 http://127.0.0.1:3000/api/health 2>/dev/null \
	    || echo "FAIL (check: docker compose logs portal)"
	@echo -n "  jobs runner    : "; \
	  $(COMPOSE) ps --status running --services 2>/dev/null \
	    | grep -qx jobs && echo running || echo "NOT RUNNING"
	@# Tolerates a gateway that is still booting. A bare `json.load` raised
	@# a full Python traceback on an empty body, which made a perfectly
	@# normal "litellm is not up yet" look like a crash in the health check
	@# itself — worse than the condition it was reporting.
	@echo -n "  models priced  : "; \
	  body=$$(curl -sS -m 10 -H "Authorization: Bearer $$(grep '^LITELLM_MASTER_KEY=' .env | cut -d= -f2-)" \
	    $(LOCAL)/v1/models 2>/dev/null); \
	  printf '%s' "$$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])), 'model(s)')" \
	    2>/dev/null \
	    || echo "unavailable — check Admin UI -> Models -> spend must be NON-ZERO"

key: ## Mint a tenant key  (make key ALIAS=acme MODELS=fast,smart BUDGET=50 DUR=30d)
	@: "$${LITELLM_MASTER_KEY:?source .env first}"
	@set -a; . ./.env; set +a; \
	  ./scripts/issue-key.sh \
	    "$${ALIAS:-$${1:-tenant}}" \
	    "$${MODELS:-fast}" \
	    "$${BUDGET:-10}" \
	    "$${DUR:-30d}"

report: ## Per-tenant usage  (make report USER=acme DAYS=30)
	@: "$${LITELLM_MASTER_KEY:?source .env first}"
	@set -a; . ./.env; set +a; \
	  ./scripts/report.sh "$${USER:-$${1:-acme}}" "$${DAYS:-30}"

reconcile: ## Cross-check cost against prices/models.yaml + upstream
	@: "$${LITELLM_MASTER_KEY:?source .env first}"
	@set -a; . ./.env; set +a; ./scripts/reconcile.sh "$${DAYS:-30}"

smoke: ## Run acceptance suite  (make smoke KEY=sk-...)
	@set -a; . ./.env; set +a; \
	  ./scripts/smoke.sh "$${KEY:-$${TENANT_KEY:-}}"

latency: ## Measure per-layer latency  (make latency KEY=sk-... SAMPLES=50)
	@set -a; . ./.env; set +a; \
	  ./scripts/measure-latency.sh --base "https://$${API_DOMAIN}" \
	    --key "$${KEY:-$${TENANT_KEY:-}}" --model "$${MODEL:-fast}" \
	    --samples "$${SAMPLES:-50}" --csv latency.csv

backup: ## Dump BOTH databases (cron: 17 3 * * *)
	./scripts/backup.sh

restore: ## Restore both databases from an archive (make restore FILE=backup-….tar.gz)
	@test -n "$(FILE)" || { echo "set FILE=backup-<stamp>.tar.gz"; exit 1; }
	./scripts/restore.sh "$(FILE)"

backup-drill: ## Prove a restore works: dump → scratch DB → sanity checks → drop
	./scripts/backup-drill.sh

pull: ## Pull a new gateway image (review release notes first)
	$(COMPOSE) pull litellm caddy

# ── Deployment: code locally, run on the VPS ─────────────────────
# Never hand-edit files on the VPS — it drifts from git and you lose
# reproducibility. The VPS holds exactly one thing git does not: .env.
# First time on the VPS: git clone, then `make init` THERE.
#
#   make deploy HOST=gateway@203.0.113.10 DIR=/opt/gateway
#   make deploy HOST=gateway@203.0.113.10 DIR=/opt/gateway
#
# SSH_KEY is optional. Without it, `ssh`/`rsync` rely on ~/.ssh/config and
# the agent — which is right for a key already listed there. It is needed
# only when the key is NOT in config, and then it must be passed to BOTH
# tools: rsync does not read the agent the way ssh(1) does, so a
# `ssh -i` alias in ~/.ssh/config is silently ignored by rsync and the
# deploy fails with "Permission denied (publickey)".
#
# `data/` is EXCLUDED from rsync. It holds the D17 payment-proof uploads
# (bind-mounted into the portal container, owned by the container's uid),
# and `--delete` tries to unlink the ones the dev box does not have — the
# unlink fails with EACCES, rsync exits 23, and the `&&` chain aborts
# BEFORE the rebuild. Worse, a deploy that could delete those files would
# be deleting customer payment evidence. Runtime state, not source.
# SERVICES names the containers to rebuild, e.g.
# `make deploy HOST=… SERVICES=portal`. Empty rebuilds everything — and
# `docker compose up --build` also rebuilds `engine` (a Rust build) and
# `searxng`, which no gateway change touches. On a 2-vCPU box that is ~20
# minutes of swapping for no new bytes.
deploy: ## Rsync repo to VPS (excludes .env), migrate, rebuild, restart
	@: "$${HOST:?set HOST=user@ip}"
	@DIR="$${DIR:-/opt/gateway}"; \
	if [ -n "$${SSH_KEY:-}" ]; then export RSYNC_RSH="ssh -i $$SSH_KEY -o IdentitiesOnly=yes"; \
	  SSH_OPTS="-i $$SSH_KEY -o IdentitiesOnly=yes"; \
	else RSYNC_RSH="ssh"; SSH_OPTS=""; fi; \
	rsync -avz --delete -e "$$RSYNC_RSH" \
	  --exclude '.env' --exclude '.git/' --exclude '_rescue/' \
	  --exclude 'backup-*.tar.gz' --exclude 'latency.csv' \
	  --exclude 'portal/node_modules/' --exclude 'portal/.next/' \
	  --exclude 'node_modules/' --exclude 'target/' --exclude '**/target/' \
	  --exclude '.turbo/' \
	  --exclude 'docker-compose.mock.yml' --exclude 'mock-upstream.log' \
	  --exclude 'docker-compose.local.yml' \
	  --exclude 'mobile-app/' \
	  --exclude 'data/' \
	  ./ "$${HOST}:$${DIR}/" && \
	ssh $$SSH_OPTS -t "$${HOST}" "cd $${DIR} && if [ -f .env ]; then \
	    make db-init && make db-migrate && \
	    docker compose up -d --build $(SERVICES) && sleep 8 && make health; \
	  else echo '  first deploy: ssh in and run: make init  (then fill .env, make probe, make up)'; fi"

verify-config: ## Validate config files parse
	@# Compose's `!reset` / `!override` tags are YAML tags PyYAML does not
	@# know, so a plain safe_load() of the local overlay raises
	@# "could not determine a constructor for the tag '!reset'". Teaching
	@# the loader the two tags is the difference between validating the
	@# file and skipping it. compose itself remains the authority on
	@# MERGE semantics — the `config` call below checks that.
	@python3 -c "import yaml, os; \
	L=yaml.SafeLoader; \
	L.add_multi_constructor('!reset', lambda l,n,v: l.construct_sequence(v) if isinstance(v, yaml.SequenceNode) else (l.construct_mapping(v) if isinstance(v, yaml.MappingNode) else l.construct_scalar(v))); \
	L.add_multi_constructor('!override', lambda l,n,v: l.construct_sequence(v) if isinstance(v, yaml.SequenceNode) else (l.construct_mapping(v) if isinstance(v, yaml.MappingNode) else l.construct_scalar(v))); \
	files=[f for f in ['docker-compose.yml','docker-compose.local.yml','docker-compose.mock.yml','config/litellm.yaml','prices/models.yaml'] if os.path.exists(f)]; \
	[yaml.load(open(f), Loader=L) for f in files]; \
	missing=[f for f in ['docker-compose.local.yml','docker-compose.mock.yml'] if not os.path.exists(f)]; \
	print('  YAML OK (' + str(len(files)) + ' files' + (', skipped local-only: ' + ','.join(missing) if missing else '') + ')')"
	@# The local overlay and the mock compose file are deliberately NOT
	@# deployed (they are in the rsync excludes), so on the VPS this target
	@# used to die with FileNotFoundError on a perfectly healthy box. Only
	@# validate the overlay's MERGE when the file is actually here.
	@if [ -f docker-compose.local.yml ]; then \
	  $(COMPOSE_LOCAL) config >/dev/null && echo "  local overlay merges OK"; \
	else \
	  echo "  local overlay absent (deploy target) — skipped"; \
	fi
	@for f in scripts/*.sh; do bash -n "$$f" && echo "  OK $$f"; done

# ── Offline-capable image builds ────────────────────────────────────
# The build needs `node:22-alpine`. On a network that can reach
# public.ecr.aws but not auth.docker.io (Docker Hub's TOKEN service —
# registry-1.docker.io itself answers fine, which makes it look like a
# transient pull failure), the pull dies with
#   "failed to fetch anonymous token ... auth.docker.io: i/o timeout".
# public.ecr.aws/docker/library/* is AWS's official mirror of the same
# images and is usually reachable when auth.docker.io is not. Tagging it
# under the Docker Hub name lets every `docker compose build` find the
# base image locally, unchanged.
#
# The `# syntax=docker/dockerfile:1` directive is also a Docker Hub pull,
# and it has been REMOVED from portal/Dockerfile so builds do not depend
# on that host at all; BuildKit's built-in frontend handles everything
# this Dockerfile uses.
docker-mirror: ## Pull base images from AWS's Docker Hub mirror (use when auth.docker.io is blocked)
	@for img in node:22-alpine; do \
	  if docker image inspect "$$img" >/dev/null 2>&1; then \
	    echo "  have $$img"; \
	  else \
	    echo "  pulling public.ecr.aws/docker/library/$$img"; \
	    docker pull "public.ecr.aws/docker/library/$$img" && \
	    docker tag "public.ecr.aws/docker/library/$$img" "$$img" || \
	    echo "  FAILED $$img — needs auth.docker.io reachable"; \
	  fi; \
	done

verify-caddy: ## Validate the Caddyfile against the real caddy binary
	@# EVERY domain the Caddyfile interpolates has to be passed. A missing
	@# one expands to an empty string, leaving a bare `{` where a site
	@# address belongs, and caddy reports the useless error
	@#   "server block without any key is global configuration"
	@# which points at line 1 and not at the unset variable. CONSOLE_DOMAIN
	@# was added to the Caddyfile and not to this target, so this check
	@# failed for every run while the config itself was fine.
	@# ADMIN_DOMAIN is deliberately absent: the Caddyfile stopped
	@# interpolating it when the console got its own vhost, so passing it
	@# here did nothing but imply a variable that still mattered. Verified
	@# with `rg '\{\$ADMIN_DOMAIN' config/Caddyfile` — no matches.
	@docker run --rm \
	  -e API_DOMAIN=$$(grep '^API_DOMAIN=' .env 2>/dev/null | cut -d= -f2-) \
	  -e CODE_DOMAIN=$$(grep '^CODE_DOMAIN=' .env 2>/dev/null | cut -d= -f2-) \
	  -e PORTAL_DOMAIN=$$(grep '^PORTAL_DOMAIN=' .env 2>/dev/null | cut -d= -f2-) \
	  -e CONSOLE_DOMAIN=$$(grep '^CONSOLE_DOMAIN=' .env 2>/dev/null | cut -d= -f2-) \
	  -v "$$PWD/config/Caddyfile:/etc/caddy/Caddyfile:ro" \
	  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
	  | grep -q 'Valid configuration' && echo "  Caddyfile OK"

check-format: verify-config ## Alias

verify-engine: ## Prove the Rust engine (extraction + search) — no Docker needed
	@# Runs on the host, not in a container: `cargo test` needs no daemon,
	@# so this gate works on a laptop and in CI where Docker is absent.
	@# Clippy runs with `-D warnings` because the engine parses untrusted
	@# input — a needless `.unwrap()` is a panic on a hostile file, and
	@# that is the one class of defect this service must not ship.
	@echo "  engine tests  :"; \
	  cargo test -p zaino-engine --quiet 2>&1 | tail -20
	@echo "  engine clippy :"; \
	  cargo clippy -p zaino-engine --all-targets --quiet -- -D warnings \
	    && echo "    clean"
	@echo "  engine binary :"; \
	  cargo build -p zaino-engine --quiet && ./target/debug/zaino-engine --version

# ── Local acceptance testing WITHOUT a real upstream key ───────────
# Runs a fake Anthropic/OpenAI-compatible upstream on the host and points
# litellm at it via host.docker.internal, so the full gateway data path
# (dual-format, streaming, spend, budgets, SSRF-body reject) is
# exercisable locally with zero spend. The override is LOCAL-ONLY and is
# excluded from deploy (see rsync --exclude below) so it can never reach
# the VPS.
MOCK_PORT ?= 8787
COMPOSE_MOCK := docker compose -f docker-compose.yml -f docker-compose.mock.yml

mock-upstream: ## Run a fake upstream on the host (background; for smoke-local)
	@# On a Linux host, LiteLLM's container reaches this service through
	@# `host.docker.internal` (the docker bridge gateway), which cannot see
	@# the host's 127.0.0.1 — so the mock must bind wider there. Only safe
	@# on a box whose firewall already denies the port. Set MOCK_HOST=0.0.0.0.
	@# `setsid` is Linux-only; macOS has no such binary, so a bare
	@# `setsid nohup node …` failed with "setsid: command not found" and
	@# the target reported FAILED on a machine that was perfectly capable
	@# of running the mock. Detach only when the binary exists.
	@# The log path is resolved per-run, not hardcoded to /tmp/mock-upstream.log.
	@# A fixed name in a sticky-bit /tmp means whoever ran this FIRST owns the
	@# file: once root had created it, every later unprivileged run failed at
	@# the redirect with "Permission denied" and this target reported the mock
	@# as unstartable. Resolve it next to the repo's other build output.
	@MOCK_LOG="$${TMPDIR:-/tmp}/mock-upstream-$$$$.log"; \
	if [ -e "$$MOCK_LOG" ] || ! : > "$$MOCK_LOG" 2>/dev/null; then \
	  MOCK_LOG="./mock-upstream.log"; \
	fi; \
	if curl -sS -m 3 http://127.0.0.1:$(MOCK_PORT)/health >/dev/null 2>&1; then \
	  echo "  mock already running on :$(MOCK_PORT)"; \
	else \
	  if command -v setsid >/dev/null 2>&1; then \
	    MOCK_HOST=$(MOCK_HOST) setsid nohup node scripts/mock-upstream.mjs >"$$MOCK_LOG" 2>&1 < /dev/null & \
	  else \
	    MOCK_HOST=$(MOCK_HOST) nohup node scripts/mock-upstream.mjs >"$$MOCK_LOG" 2>&1 < /dev/null & \
	  fi; \
	  sleep 2; \
	  if curl -sS -m 5 http://127.0.0.1:$(MOCK_PORT)/health >/dev/null 2>&1; then \
	    echo "  mock-upstream up on http://127.0.0.1:$(MOCK_PORT) (MOCK_HOST=$(MOCK_HOST))"; \
	  else \
	    echo "  FAILED to start mock-upstream — see $$MOCK_LOG"; \
	    tail -5 "$$MOCK_LOG" 2>/dev/null; exit 1; \
	  fi; \
	fi

smoke-local: ## Bring up litellm against the local mock and print smoke instructions
	@$(MAKE) --no-print-directory mock-upstream
	@echo "  starting litellm against the mock (UPSTREAM_BASE_URL=http://host.docker.internal:$(MOCK_PORT))"
	@$(COMPOSE_MOCK) up -d litellm
	@sleep 6
	@echo "  ✓ litellm restarted against mock. Run:"
	@echo "      set -a; . ./.env; set +a; \\"
	@echo "      KEY=\$$(./scripts/issue-key.sh local fast 5 30d | python3 -c 'import sys,json;print(json.load(sys.stdin)[\"key\"])'); \\"
	@echo "      SMOKE_BASE=http://127.0.0.1:4000 ./scripts/smoke.sh \"\$$KEY\""

real-upstream: ## Restart litellm against the real UPSTREAM_BASE_URL from .env
	$(COMPOSE) up -d litellm
	@sleep 6
	@echo "  ✓ litellm restarted against the real upstream"

# ── Metering proof ────────────────────────────────────────────────────
# Proves the whole billing path against a live stack with zero spend:
# signup → org + LiteLLM team → minted key → real requests until the
# budget ceiling bites → the gateway's spend ledger → the collector →
# usage_records with correct tokens and cost → rollup → revoke.
# Uses the mock upstream so the proof is deterministic and repeatable
# (`make verify-metering` as often as you like), then restores litellm
# to the upstream in .env when it finishes.
verify-d17: ## Prove the manual D17 payment path (duplicate, expiry, double-approve, staff gate)
	@$(COMPOSE) build jobs
	@$(COMPOSE) run --rm --no-deps jobs node --experimental-transform-types \
	  --import ./scripts/register-ts-resolve.mjs scripts/verify-d17.ts

verify-dodo: ## Prove the Dodo payment path (checkout, seats, signed webhook, replay, grace, cancel)
	@$(COMPOSE) build jobs
	@$(COMPOSE) run --rm --no-deps jobs node --experimental-transform-types \
	  --import ./scripts/register-ts-resolve.mjs scripts/verify-dodo.ts

verify-grant: ## Prove the manual plan grant (one row, one-live-row, idempotent window, audit, cut)
	@$(COMPOSE) build jobs
	@$(COMPOSE) run --rm --no-deps jobs node --experimental-transform-types \
	  --import ./scripts/register-ts-resolve.mjs scripts/verify-grant.ts

verify-metering: ## Prove metering end-to-end (usage_records, cost, dedupe, revoke)
	@# Preflight, and it must be a hard STOP.
	@#
	@# This proof drives the REAL POST /api/billing/callback and signs with
	@# the dev scheme (devSignBody). The PORTAL verifies with whatever
	@# BILLING_PROVIDER it was started with — baked into the container, so a
	@# shell override here cannot reach it. On a production box (d17) every
	@# callback came back 400 "Invalid callback signature".
	@#
	@# That failure used to surface at section 5 of 27, by which point the
	@# run had already INSERTed an org, a user, a subscription and an
	@# entitlement — so a wrong-environment run left fixtures in the real
	@# customer database instead of refusing to start. Refusing up front is
	@# the fix; leaking is not a "skip".
	@#
	@# exit 1 (not 0): `exit` only ends this ONE recipe line's shell, so a
	@# zero here would let make carry on into the next line exactly as
	@# before. Non-zero is what actually stops the target.
	@running=$$(docker exec gateway-portal-1 sh -lc 'printenv BILLING_PROVIDER' 2>/dev/null \
	  || sudo docker exec gateway-portal-1 sh -lc 'printenv BILLING_PROVIDER' 2>/dev/null || true); \
	if [ "$$running" != "dev" ]; then \
	  echo ""; \
	  echo "  STOP: verify-metering needs the PORTAL on BILLING_PROVIDER=dev."; \
	  echo "        It is currently running BILLING_PROVIDER=$${running:-<unset>}."; \
	  echo ""; \
	  echo "  This proof signs callbacks with the dev scheme and posts them to"; \
	  echo "  the live /api/billing/callback, so the portal must verify with the"; \
	  echo "  same scheme. It is refused here rather than half-run, because a"; \
	  echo "  mid-run failure leaves an org+subscription fixture in the real DB."; \
	  echo ""; \
	  echo "  To run it: set BILLING_PROVIDER=dev in .env, then"; \
	  echo "    docker compose up -d portal && make verify-metering"; \
	  echo "  and put it back to d17 afterwards. Everything else on this box"; \
	  echo "  (health, smoke, verify-grant, verify-d17, backup-drill) runs"; \
	  echo "  against d17 as-is."; \
	  echo ""; \
	  exit 1; \
	fi; \
	echo "  preflight ok — portal is running BILLING_PROVIDER=dev"
	@$(MAKE) --no-print-directory mock-upstream
	@echo "  pointing litellm at the local mock (deterministic, zero spend)"
	@$(COMPOSE_MOCK) up -d litellm
	@echo "  waiting for litellm readiness..."
	@for i in $$(seq 1 40); do \
	  code=$$(curl -sS -m 5 -o /dev/null -w '%{http_code}' $(LOCAL)/health/readiness 2>/dev/null || true); \
	  if [ "$$code" = "200" ]; then echo "  litellm ready"; break; fi; \
	  if [ "$$i" = "40" ]; then echo "  litellm not ready — aborting"; exit 1; fi; \
	  sleep 2; \
	done
	@$(COMPOSE) build jobs
	@# --no-deps is load-bearing: `docker compose run` reconciles the
	@# dependencies of the service against the compose files it is given.
	@# Run with the base file while litellm is deliberately pointed at the
	@# mock override, compose would RECREATE litellm back to the .env
	@# upstream mid-run and the proof would dial a restarting gateway.
	@status=0; $(COMPOSE) run --rm --no-deps jobs node --experimental-transform-types \
	  --import ./scripts/register-ts-resolve.mjs scripts/verify-metering.ts || status=$$?; \
	  $(COMPOSE) up -d litellm; \
	  for i in $$(seq 1 40); do \
	    code=$$(curl -sS -m 5 -o /dev/null -w '%{http_code}' $(LOCAL)/health/readiness 2>/dev/null || true); \
	    [ "$$code" = "200" ] && break; sleep 2; \
	  done; \
	  echo "  ✓ litellm restored to the upstream from .env"; \
	  exit $$status

# ── End-to-end, against the running local stack ─────────────────────
# Points Playwright at Caddy (:80) rather than the portal's own port, so the
# test exercises the same path a browser takes — vhost routing, the body
# ceilings, and the proxy timeouts included. The two specs that need a
# session are skipped when the env vars are absent, so this is safe to run
# before `make accounts`.
#
# Credentials are the `make accounts` defaults; override any of them on the
# command line.
e2e: ## Run the Playwright suite against the local stack
	@cd portal && \
	  E2E_BASE_URL=http://$$(grep '^PORTAL_DOMAIN=' ../.env | cut -d= -f2-) \
	  E2E_EMAIL="$(LOCAL_CUSTOMER_EMAIL)" \
	  E2E_PASSWORD="$(LOCAL_PASSWORD)" \
	  E2E_STAFF_EMAIL="$(LOCAL_STAFF_EMAIL)" \
	  E2E_STAFF_PASSWORD="$(LOCAL_PASSWORD)" \
	  E2E_ADMIN_ORIGIN=http://$$(grep '^CONSOLE_DOMAIN=' ../.env | cut -d= -f2-) \
	  ADMIN_GATE_SECRET=$$(grep '^ADMIN_GATE_SECRET=' ../.env | cut -d= -f2-) \
	  npx playwright test

plan: ## Put the local customer account on a plan so models and chat work
	@$(COMPOSE) run --rm --no-deps \
	  -e PLAN_EMAIL="$(LOCAL_CUSTOMER_EMAIL)" \
	  -e PLAN_CODE="$(PLAN)" \
	  jobs node --experimental-transform-types \
	  --import ./scripts/register-ts-resolve.mjs scripts/grant-plan.ts

health-local: ## Health check for the Docker Desktop stack (adds the Caddy entry points)
	@$(MAKE) --no-print-directory health
	@echo -n "  caddy :80      : "; \
	  code=$$(curl -sS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1/ 2>/dev/null); \
	  if [ -n "$$code" ] && [ "$$code" != "000" ]; then \
	    echo "answering (got $$code) — reachable from the host"; \
	  else echo "FAIL — nothing on :80 (check: docker compose -f docker-compose.yml -f docker-compose.local.yml logs caddy)"; fi
	@echo -n "  portal vhost   : "; \
	  code=$$(curl -sS -m 10 -o /dev/null -w '%{http_code}' \
	    -H "Host: $$(grep '^PORTAL_DOMAIN=' .env | cut -d= -f2-)" \
	    http://127.0.0.1/sign-in 2>/dev/null); \
	  if [ "$$code" = "200" ]; then echo "OK (200) — sign-in page renders through Caddy"; \
	  else echo "FAIL (got $$code)"; fi
	@echo -n "  session gate   : "; \
	  code=$$(curl -sS -m 10 -o /dev/null -w '%{http_code}' \
	    -H "Host: $$(grep '^PORTAL_DOMAIN=' .env | cut -d= -f2-)" \
	    http://127.0.0.1/chat 2>/dev/null); \
	  if [ "$$code" = "307" ] || [ "$$code" = "302" ]; then \
	    echo "OK ($$code to /sign-in) — auth is enforced, not bypassed"; \
	  else echo "UNEXPECTED (got $$code) — an anonymous /chat should redirect"; fi
	@echo -n "  edge + api     : "; \
	  code=$$(curl -sS -m 10 -o /dev/null -w '%{http_code}' \
	    -H "Host: api.localhost" http://127.0.0.1/__edge/health 2>/dev/null); \
	  if [ "$$code" = "200" ]; then echo "OK (200) — caddy -> auth-edge over the bridge"; \
	  else echo "FAIL (got $$code) — check: docker compose -f docker-compose.yml -f docker-compose.local.yml logs auth-edge"; fi

test-local: ## run the portal gates against this checkout
	@cd portal && npx tsc --noEmit && echo "  tsc OK"
	@cd portal && npx vitest run 2>&1 | tail -5
