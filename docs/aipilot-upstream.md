# Using AiPilot as the Zaino gateway upstream

> Setup guide for pointing the gateway's data plane at
> `https://aipilot-weld.vercel.app/v1` instead of the current upstream.
> Companion to `CONTEXT.md` §4 (models and tiers) and `docs/device-code-flow.md`.

## 0. Status

**Blocked as of 2026-10-21.** The supplied key
`ap_live_fbmOL2flEyvn4oOa5_m_bH_uPgfOieby` returns `402` on every chat
completion:

```
{"error":{"message":"Your free trial has ended. ...","type":"billing_error","code":402}}
```

`GET /v1/models` succeeds and lists `opus-5.5`, `sonnet-5.5`, `haiku-5.5`
(context window 1,048,576). Until an active AiPilot key/subscription is
available, do **not** flip `UPSTREAM_*` — the gateway would serve 402 to
every customer. Re-run the probe in §2 after obtaining a working key.

## 1. Tier mapping (AiPilot → Zaino aliases)

AiPilot exposes three models that map cleanly onto the three Zaino aliases
by capability/latency:

| Zaino alias | AiPilot model | Rationale |
|---|---|---|
| `fast` | `haiku-5.5` | fastest, smallest — matches the `fast` tier promise |
| `smart` | `sonnet-5.5` | everyday coding — the default workhorse |
| `frontier` | `opus-5.5` | most capable — Pro-only |

**Invariant:** customers still see only `fast` / `smart` / `frontier`. The
AiPilot model names live only in `config/litellm.yaml` (and nowhere on the
customer surface, in logs, or in the portal). `prices/models.yaml` must be
updated to keep the two rate tables in lockstep (enforced by
`portal/tests/pricing-consistency.test.ts`).

## 2. Verify the upstream before touching config

```sh
# 2a. Model list (must succeed; no auth error)
curl -sS -m 20 https://aipilot-weld.vercel.app/v1/models \
  -H "Authorization: Bearer $AIPILOT_API_KEY" | jq '.data[].id'

# 2b. One chat completion per tier model (must return 200, not 402/401)
for m in haiku-5.5 sonnet-5.5 opus-5.5; do
  echo "== $m =="
  curl -sS -o /dev/null -w "%{http_code}\n" -m 30 \
    https://aipilot-weld.vercel.app/v1/chat/completions \
    -H "Authorization: Bearer $AIPILOT_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":8}"
done
```

If any returns non-200, stop — do not proceed to §3.

## 3. Switch the gateway

### 3a. `.env` (on the VPS, never committed)

```sh
UPSTREAM_BASE_URL=https://aipilot-weld.vercel.app/v1
UPSTREAM_API_KEY=ap_live_...   # active key, not the expired trial one
```

`LITELLM_ANTHROPIC_DISABLE_URL_SUFFIX` stays unset — AiPilot's base URL
already carries `/v1` and it is OpenAI-compatible, so the default suffix
behaviour is correct (same as the GhostCLI note in `.env.example`).

### 3b. `config/litellm.yaml`

Replace each of the three alias entries' `litellm_params`:

```yaml
  - model_name: fast
    litellm_params:
      model: openai/haiku-5.5
      api_base: os.environ/UPSTREAM_BASE_URL
      api_key: os.environ/UPSTREAM_API_KEY
      timeout: 240
      num_retries: 6
      cooldown_time: 3
    model_info:
      supported_endpoints: ["/v1/chat/completions"]
      input_cost_per_token: 0.00000015
      output_cost_per_token: 0.0000006
      cache_creation_input_token_cost: 0.0000003
      cache_read_input_token_cost: 0.000000015
```

Repeat for `smart` (`openai/sonnet-5.5`) and `frontier` (`openai/opus-5.5`),
keeping the alias names. Update the header comment to name AiPilot.

### 3c. `prices/models.yaml`

Update the `deployments:` list under each tier to the AiPilot model name so
the portal and `reconcile.sh` agree with LiteLLM:

```yaml
fast:
  deployments: [haiku-5.5]
  ...
smart:
  deployments: [sonnet-5.5]
  ...
frontier:
  deployments: [opus-5.5]
  ...
```

AiPilot publishes no pricing in `/v1/models`, so keep the existing nominal
rates (placeholders) and revisit before customer money depends on them — see
`CONTEXT.md` §4 ("Prices are placeholders").

### 3d. Redeploy

```sh
make verify-config
make deploy HOST=gateway@<VPS_IP>
make db-migrate          # no new migration; harmless
docker compose build portal && docker compose build jobs && docker compose up -d
make health
```

## 4. Probe the gateway

```sh
make probe               # should report "openai-compatible" for all three
./scripts/smoke.sh zn-<test-key>
```

`smoke.sh` must show `/v1/models` returning exactly `fast`, `smart`,
`frontier` and a successful streamed chat on `fast`.

## 5. Rollback

Revert `.env` (`UPSTREAM_BASE_URL`/`UPSTREAM_API_KEY`) and `config/litellm.yaml`
to the NVIDIA values, redeploy. No migration is involved, so rollback is a
config revert + restart. Do **not** leave a half-switched state: `.env` and
`litellm.yaml` must agree on the same upstream.

## 6. Notes

- AiPilot's context window is 1,048,576 tokens. If desired, bump the
  `[models.*]` `model_context_window` in the Codex client config
  (`CONTEXT.md` §9) from 262144 — but keep the gateway's own
  `prices/models.yaml` context values aligned with what the portal advertises.
- AiPilot does not serve `/v1/messages` or `/v1/responses` natively; the
  auth-edge Responses shim (`edge/responses-shim.mjs`) and LiteLLM's
  Anthropic translation still apply unchanged. Keep `supported_endpoints`
  as `[chat/completions]` only.
- The gateway key (`zn-…`) and the AiPilot key (`ap_live_…`) are different
  credentials with different lifetimes. The AiPilot key lives only in the
  VPS `.env` and must be backed up off-box alongside `LITELLM_SALT_KEY`.
