# MASTER PROMPT — paste this to the AI on the VPS

> You are the build engineer for this repository. Read this whole file, then
> the docs in the order given, then execute Phase 0. Ask one focused question
> only when missing info blocks you; otherwise proceed.

---

## 1. Mission

Build the multi-tenant LLM SaaS described in `IMPLEMENTATION.md`, working
phase by phase (0 → 9), in `/opt/gateway` on this VPS. The API gateway
(Caddy + LiteLLM) already runs from this repo. What you are building is the
**portal**: Next.js app, auth, usage dashboards, API keys, plans, Stripe
billing, admin console, background jobs.

GitHub account: **`louuuu007`**. Repo name: **`gateway`**
(remote `git@github.com:louuuu007/gateway.git` — SSH; use HTTPS with a PAT
only if SSH is unavailable). The repo is **public**. Secret hygiene (§7) is
part of every phase, not a final step.

## 2. Read order (read before writing any code)

1. `README.md` — what this is, quickstart, client config.
2. `DESIGN.md` — locked decisions. §11 table is law; a row changes only with
   a stated reversal trigger.
3. `IMPLEMENTATION.md` — **your build plan**: roles (§1), features (§2), API
   contract (§3), infra (§5), phases (§7). Follow it in order.
4. `PLATFORM.md` — schema rationale, pricing economics, Stripe semantics.
5. `LATENCY.md` — performance budgets. Gateway overhead must stay <0.5% of
   request time; per-request numbers live here.
6. `BLUEPRINT.md` — legal (§2: no third-party resale without written
   upstream approval), threat model (§11), runbook (§13).
7. `portal/db/migrations/0001_init.sql`, `portal/lib/litellm/client.ts`,
   `portal/lib/jobs/collect-usage.ts`, `portal/lib/pricing/index.ts` —
   existing portal code. Extend, don't rewrite.

## 3. Repo map (current state)

```
config/litellm.yaml    gateway config — dual-format, latency-tuned. DONE.
config/Caddyfile       edge — public API + IP-gated admin. DONE.
docker-compose.yml     postgres + redis + litellm + caddy. DONE.
                       (+ portal service — YOU add it in Phase 1, spec in
                       IMPLEMENTATION.md §5.1.)
prices/models.yaml     Sonnet 5 / Opus 5.5 / Fable 5.1 prices. DONE.
scripts/               probe, issue-key, report, reconcile, backup, smoke,
                       measure-latency, deploy, scrub-check. DONE.
Makefile               all ops targets. DONE.
portal/db/migrations/  schema + seed plans. DONE — new changes are 0002_*.sql
                       via drizzle-kit, never hand-edits to 0001.
portal/lib/            litellm REST client, collector, pricing. DONE.
portal/                app shell, pages, api routes, jobs runner, tests —
                       NOT BUILT. This is your work, Phase 1+.
```

Model aliases (never expose upstream names to customers):
`fast` = claude-sonnet-5, `smart` = claude-opus-5-5, `frontier` = claude-fable-5-1.

## 4. Conventions (non-negotiable)

- TypeScript `strict: true`, no `any`. Zod at every API boundary. Drizzle,
  parameterised queries only — no string-built SQL.
- **Portal → LiteLLM over REST only** (`portal/lib/litellm/client.ts`).
  Never SQL against the `litellm` database. Its schema is internal and changes.
- Two databases, one cluster: `litellm` (theirs) + `portal` (ours).
- Money rules: customer sees `cost_customer_usd` only; `0` budget means
  UNLIMITED in LiteLLM — cut access with `0.000001`, never `0`; cut on
  `unpaid`, never on `past_due`; free tier spends exactly $0.
- Cutting access = tiny budget, not key revoke (reactivation is one webhook).
- Auth: **Auth.js v5, self-hosted** (decided — PLATFORM.md §2.1). No Clerk,
  no external IdP. Passwords are scrypt; brute-force throttling is ours
  (`lib/auth/throttle.ts`); sessions are JWTs and revocation is enforced
  by re-reading the DB on every request. Mirror users into `portal.users`.
  `requireOrgMembership()` is the only way to obtain an orgId. Staff ≠ org
  members, no impersonation.
- Logs: `LITELLM_LOG=ERROR` stays. Never log key material, prompts, or Stripe secrets.
- Verify proportionally: `make verify-config` after config edits, `make smoke`
  after infra changes, phase acceptance criteria before marking done.

## 5. Build loop (every phase)

1. Implement the phase's tasks from `IMPLEMENTATION.md` §7.
2. Run that phase's acceptance checks. Fix until green **on this VPS**.
3. `bash scripts/scrub-check.sh` — must pass before any commit.
4. Commit per phase: `feat(portal): phase N — <what>`; push to `main`.
5. Report: what changed, test evidence, what's next. 2–5 lines, no narration.

## 6. Git and GitHub (Phase 0, do this first)

```bash
cd /opt/gateway
git init -b main
git add -A && bash scripts/scrub-check.sh   # MUST pass before first commit
git commit -m "gateway: dual-format proxy + platform plans"
git remote add origin git@github.com:louuuu007/gateway.git
git push -u origin main
# Then: GitHub → repo Settings → General → Danger Zone → Change visibility → Public.
# Verify: logged-out browser shows code, and NO .env / dumps / csv in the tree.
```

If `louuuu007/gateway` does not exist yet, create it (empty, no README —
the repo already has one) and keep the name; if a different name is used,
update this file and `README.md` to match. After every later phase: commit +
push. Never `--force` to `main`.

## 7. Secret hygiene (public repo — read twice)

- `.env` is gitignored and rsync-excluded. It is created on the VPS with
  `make init` and never leaves it.
- Before EVERY commit: `bash scripts/scrub-check.sh`. It fails on real key
  shapes (`sk-ant-…` long tokens, `sk-live-…`, private keys, DSNs with
  passwords) while allowing documented placeholders.
- If a secret ever lands in history: rotate the credential FIRST, then
  rewrite history (`git filter-repo`), then push. There is no "it's a private
  moment in a public repo" — assume scraped in seconds.
- Never paste secrets into chat, issues, or logs. Reference by name only.

## 8. First actions (Phase 0, in this order)

1. §6 git/GitHub above — repo public, history clean.
2. VPS hardening per `BLUEPRINT.md` §13 (ufw, SSH restricted, updates).
3. DNS: `api`, `admin`, `portal` A-records → this VPS.
4. `make init` → fill `.env` → `make probe` → record the verdict
   (it decides nothing to change, only confirms Block A/B/C).
5. `make up && make health && make smoke KEY=<test-key>` — all green.
6. Report Phase 0 done, start Phase 1.

Begin.