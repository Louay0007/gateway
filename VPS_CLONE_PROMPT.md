# VPS AI — CLONE & CONTEXT PROMPT

> Paste this to the AI on the VPS. It assumes `/opt/gateway` was synced
> from local (rsync, no git history yet). Its job: absorb the project,
> put it on GitHub, prove the gateway runs.

---

You are working on a VPS (`ubuntu@15.224.52.176`). The project lives at
`/opt/gateway` — plain files, no git history. Your two jobs, in order:

**JOB 1 — GET CONTEXT.** Read these files fully, in this order, before
touching anything:

1. `README.md` — what this is, how to operate it.
2. `DESIGN.md` — locked architecture decisions (§11 is law).
3. `IMPLEMENTATION.md` — the full build plan: roles, features, API
   contract, infra, phases 0–9. You will execute this after Job 2.
4. `PLATFORM.md` — pricing economics, schema rationale, Stripe semantics.
5. `LATENCY.md` — performance budgets and the three models.
6. `BLUEPRINT.md` — legal (§2) and threat model (§11).
7. `MASTER_PROMPT.md` — your standing orders after Job 2
   (conventions, build loop, secret hygiene).

Then read the live configs: `docker-compose.yml`, `config/litellm.yaml`,
`config/Caddyfile`, `prices/models.yaml`, `.env.example`, `Makefile`.
Do NOT read or print `.env` values — confirm only that it exists with
`chmod 600` ownership `ubuntu:ubuntu`.

Key facts to internalise:
- Aliases, never upstream names, face customers: `fast` = claude-sonnet-5,
  `smart` = claude-opus-5-5, `frontier` = claude-fable-5-1.
- Portal talks to LiteLLM over REST only — never SQL on its database.
- Cutting access = tiny budget (`0.000001`), never `0` (means unlimited),
  never key revoke for suspensions.
- Budgets silently no-op without Postgres — verify, don't assume.

**JOB 2 — PUSH TO GITHUB.** Public repo `louuuu007/gateway`:

```bash
cd /opt/gateway
bash scripts/scrub-check.sh        # MUST pass before any commit
git init -b main
git add -A && bash scripts/scrub-check.sh
git commit -m "gateway: dual-format proxy + platform plans"
git remote add origin git@github.com:louuuu007/gateway.git
git push -u origin main
```

If the repo doesn't exist yet, create empty `louuuu007/gateway` first
(no README — one exists here). If SSH to GitHub fails, say so and stop —
do NOT embed any token in commands or files. After pushing: set the repo
**Public**, then verify in a logged-out browser that the tree shows code
and contains NO `.env`, dumps, or `latency.csv`.

**JOB 3 — PROVE IT RUNS** (only after Jobs 1–2):

```bash
cd /opt/gateway
make init        # creates VPS-only .env — it never enters git
# fill .env: API_DOMAIN, PORTAL_DOMAIN, CONSOLE_DOMAIN, UPSTREAM_* …
make probe       # record the verdict (confirms Block A/B/C)
make up && make health && make smoke KEY=<test-key-from-make-key>
```

Report back: (1) one paragraph proving you absorbed the context
(architecture in your own words), (2) the GitHub URL, (3) probe verdict +
smoke result, (4) what Phase 1 needs from the human (upstream API key +
`.env` domains; Clerk/Stripe test keys are NOT needed — auth is self-hosted
Auth.js, see PLATFORM.md §2.1). Short. Then await orders — do not start
Phase 1 unprompted.