# LLM Gateway — operations entry points.
# Full decisions in DESIGN.md. Analysis and runbook in BLUEPRINT.md.

SHELL := /bin/bash
COMPOSE := docker compose
LOCAL := http://127.0.0.1:4000

.DEFAULT_GOAL := help
.PHONY: help init probe up down restart logs ps health key report \
        reconcile smoke latency backup restore pull deploy verify-config \
        check-format verify-caddy db-init db-migrate jobs jobs-once

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

init: ## Create .env from template with generated secrets
	@test -f .env && { echo ".env already exists — refusing to overwrite"; exit 1; }
	@cp .env.example .env
	@sed -i '' -e "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=sk-$$(openssl rand -hex 32)|" .env
	@sed -i '' -e "s|^LITELLM_SALT_KEY=.*|LITELLM_SALT_KEY=sk-$$(openssl rand -hex 32)|" .env
	@sed -i '' -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$(openssl rand -hex 24)|" .env
	@sed -i '' -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$$(openssl rand -hex 24)|" .env
	@sed -i '' -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$$(openssl rand -base64 32)|" .env
	@chmod 600 .env
	@echo ""
	@echo "  .env created with generated secrets (0600)."
	@echo "  NOW EDIT THESE — nothing works until you do:"
	@echo "    API_DOMAIN, ADMIN_DOMAIN, PORTAL_DOMAIN,"
	@echo "    UPSTREAM_BASE_URL, UPSTREAM_API_KEY"
	@echo ""
	@echo "  BACK UP LITELLM_SALT_KEY AND AUTH_SECRET SEPARATELY."
	@echo "  Neither is in the database dump."
	@echo ""
	@echo "  Next: make probe"

probe: ## Detect which wire formats the upstream supports  (RUN FIRST)
	@: "$${UPSTREAM_BASE_URL:?source .env first}"; \
	 set -a; . ./.env; set +a; ./scripts/probe-upstream.sh

up: ## Start the stack
	$(COMPOSE) up -d
	@echo "Waiting for health..."
	@sleep 5
	@$(MAKE) --no-print-directory health

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
	$(COMPOSE) run --rm jobs node --experimental-transform-types \
	  --import ./scripts/register-ts-resolve.mjs scripts/jobs.ts once

jobs-once: jobs ## Alias

health: ## Check gateway, portal, jobs, Postgres and pricing wiring
	@echo -n "  gateway health : "; \
	  KEY=$$(grep '^LITELLM_MASTER_KEY=' .env | cut -d= -f2-); \
	  code=$$(curl -sS -m 10 -o /dev/null -w '%{http_code}' \
	    -H "Authorization: Bearer $$KEY" $(LOCAL)/health 2>/dev/null); \
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
	@echo -n "  models priced  : "; \
	  curl -sS -m 10 -H "Authorization: Bearer $$(grep '^LITELLM_MASTER_KEY=' .env | cut -d= -f2-)" \
	    $(LOCAL)/v1/models 2>/dev/null \
	    | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])), 'model(s)')" \
	    || echo "check Admin UI -> Models -> spend must be NON-ZERO"

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

pull: ## Pull a new gateway image (review release notes first)
	$(COMPOSE) pull litellm caddy

# ── Deployment: code locally, run on the VPS ─────────────────────
# Never hand-edit files on the VPS — it drifts from git and you lose
# reproducibility. The VPS holds exactly one thing git does not: .env.
# First time on the VPS: git clone, then `make init` THERE.
#
#   make deploy HOST=gateway@203.0.113.10 DIR=/opt/gateway
deploy: ## Rsync repo to VPS (excludes .env), migrate, rebuild, restart
	@: "$${HOST:?set HOST=user@ip}"
	@DIR="$${DIR:-/opt/gateway}"; \
	rsync -avz --delete \
	  --exclude '.env' --exclude '.git/' \
	  --exclude 'backup-*.tar.gz' --exclude 'latency.csv' \
	  --exclude 'portal/node_modules/' --exclude 'portal/.next/' \
	  --exclude 'docker-compose.mock.yml' --exclude 'mock-upstream.log' \
	  ./ "$${HOST}:$${DIR}/" && \
	ssh -t "$${HOST}" "cd $${DIR} && if [ -f .env ]; then \
	    make db-init && make db-migrate && \
	    docker compose up -d --build && sleep 8 && make health; \
	  else echo '  first deploy: ssh in and run: make init  (then fill .env, make probe, make up)'; fi"

verify-config: ## Validate config files parse
	@python3 -c "import yaml;[yaml.safe_load(open(f)) for f in \
	  ['docker-compose.yml','config/litellm.yaml','prices/models.yaml']];print('  YAML OK')"
	@for f in scripts/*.sh; do bash -n "$$f" && echo "  OK $$f"; done

verify-caddy: ## Validate the Caddyfile against the real caddy binary
	@docker run --rm \
	  -e API_DOMAIN=$$(grep '^API_DOMAIN=' .env 2>/dev/null | cut -d= -f2-) \
	  -e ADMIN_DOMAIN=$$(grep '^ADMIN_DOMAIN=' .env 2>/dev/null | cut -d= -f2-) \
	  -e CODE_DOMAIN=$$(grep '^CODE_DOMAIN=' .env 2>/dev/null | cut -d= -f2-) \
	  -e PORTAL_DOMAIN=$$(grep '^PORTAL_DOMAIN=' .env 2>/dev/null | cut -d= -f2-) \
	  -v "$$PWD/config/Caddyfile:/etc/caddy/Caddyfile:ro" \
	  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
	  | grep -q 'Valid configuration' && echo "  Caddyfile OK"

check-format: verify-config ## Alias

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
	@pgrep -f 'mock-upstream.mjs' >/dev/null && { echo "  mock already running on :$(MOCK_PORT)"; exit 0; }
	@nohup node scripts/mock-upstream.mjs >/tmp/mock-upstream.log 2>&1 &
	@sleep 1
	@curl -sS -m 5 http://127.0.0.1:$(MOCK_PORT)/health >/dev/null \
	  && echo "  mock-upstream up on http://127.0.0.1:$(MOCK_PORT)" \
	  || { echo "  FAILED to start mock-upstream — see /tmp/mock-upstream.log"; exit 1; }

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
	@$(COMPOSE) up -d litellm
	@sleep 6
	@echo "  ✓ litellm restarted against the real upstream"
