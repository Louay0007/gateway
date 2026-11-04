# VPS performance review + migration plan

**Date:** 3 November 2026
**Host inspected:** `gateway` (15.224.52.176) — AWS Lightsail, eu-west-3a Paris, `i-0e3b0d51764aac305`
**Method:** live read-only reconnaissance over SSH. No changes were made to production.
**Scope:** every host setting, every service, every env var, plus a right-sizing and migration plan.

---

## 0. Headline

The box is not failing because it is too slow. It is failing because **four things are
misconfigured on it**, and two of those make it look like a hardware problem:

| What it looks like | What it actually is |
|---|---|
| "We need a bigger VPS" | 3.7 GB RAM, ~3.5 GB of container peaks, 1.9 GB in swap, an OOM kill on Oct 25 |
| "The box is slow after deploys" | Rust/Tauri builds running **on the production host** (3.7 GB of `desktop/`, 1.7 GB of `target/`, 31 GB of build cache) |
| "Disk is nearly full" | 31 GB of reclaimable containerd build cache + 5.5 GB of artifacts that should never be on prod |
| "Deploys are flaky" | The deploy workflow **refuses to run at all** — the VPS tree is dirty (112 files), so nothing has deployed since Oct 27 |

**Money first:** cleaning up Phase 0 reclaims ~36 GB of disk, removes the swap pressure,
and eliminates the OOM cause — for $0. That may be enough to make an 8 GB box correct
instead of a 16 GB box. Read §6 before ordering hardware.

---

## 1. Current host — factual inventory

### 1.1 Compute

```
Instance      AWS Lightsail "Medium-4GB"  ($24/mo, 2 vCPU / 4 GB / 80 GB SSD / 4 TB)
Instance ID   i-0e3b0d51764aac305
Region        eu-west-3a (Paris)
OS            Ubuntu 24.04.4 LTS, kernel 7.0.0-1014-aws
CPU           2 vCPU — Intel Xeon Platinum 8259CL @ 2.50 GHz, KVM, BURSTABLE
              (1 core / 2 threads — hyperthreads, not 2 real cores)
RAM           3.7 GiB usable
Disk          77 GB ext4 on /dev/nvme0n1p1, 61 GB used, 17 GB free (79%)
Uptime        15.8 days
```

### 1.2 Memory — this is the real constraint

```
              total  used   free  buff/cache  available
Mem:          3.7Gi  1.9Gi  770Mi   1.5Gi      1.9Gi
Swap:         4.0Gi  1.9Gi                    <-- 48% of swap consumed
  /swapfile    2.0G used  1.2G
  /swapbuild   2.0G used  734M   <-- name suggests a leftover from a build
vm.swappiness = 10
```

Per-container memory peaks (cgroup `memory.peak`, since container start):

| Container | Peak RSS | Steady RSS |
|---|---|---|
| `litellm` | **3.08 GB** | 164–283 MB |
| `portal` | 193 MB | 95 MB |
| `postgres` | 143 MB | 108 MB |
| `jobs` | 103 MB | 46 MB |
| `caddy` | ~21 MB | 21 MB |
| `auth-edge` | ~14 MB | 14 MB |
| `redis` | ~5 MB | 5 MB |

**OOM kill confirmed:** 25 Oct 11:30 UTC, a `python3` process (1.36 GB anon-rss) inside a
Docker cgroup, `global_oom`. Journal has 311 OOM-related lines in the last 30 days.

Swap currently held by process:

```
469 MB  python3 (LiteLLM worker, pid 521024)
464 MB  python3 (LiteLLM worker, pid 539681)
453 MB  litellm (pid 2401587)
278 MB  opencode (pid 429130)     <-- a user-space dev server, not a service
156 MB  dockerd
 62 MB  Runner.Listener
```

That is ~1.9 GB of live pages on the same physical disk that serves Postgres. **Every
swap-in is a disk read that competes with the database.** This is the mechanism behind
"the VPS feels sluggish" — not CPU.

### 1.3 CPU — measured, and it is NOT the problem

Three days of `sar` history:

```
sa01  peak_busy=100.0%  avg_busy=3.0%   max_steal=1.11%
sa02  peak_busy=100.0%  avg_busy=4.7%   max_steal=9.17%
sa03  peak_busy=100.0%  avg_busy=3.8%   max_steal=19.97%
```

Average utilisation is **3–5%**. Peak 100% is brief and correlates with builds. The
20% steal on Nov 3 is burstable-credit starvation: `t3.medium` baseline is 20% per vCPU,
so a sustained build drains the credit balance and the hypervisor throttles to baseline.

Note also `19.97% iowait` on the same sample — that is the swap/disk contention above,
not CPU contention.

`vmstat` steal over 60 s idle: 0.33%.

### 1.4 Disk — 79% full, and the biggest single item is disposable

```
/            61G used / 77G   79%
  /var       38G   -> /var/lib/containerd = 36G
                       31G  snapshotter/v1.overlayfs/snapshots  (574 snapshots)
                      4.5G  content store
  /opt       9.5G
    desktop/           3.7G   <-- untracked Rust/Tauri build output
    data/downloads     2.4G   <-- legit: desktop installers, served by Caddy
    target/            1.7G   <-- Rust build dir
    portal/            978M
    2 x backup-*.tar.gz 834M  <-- pre-deploy tarballs, on the same disk
  /home      6.7G
    actions-runner     2.1G
    gateway-backups    419M
  /usr       2.7G
```

```
docker system df
Images         13   8 active   6.42 GB   2.9 GB reclaimable (45%)
Containers      8   7 active   89.9 MB
Local Volumes   6   4 active   1.04 GB   98.7 MB reclaimable
Build Cache   343          0   31.34 GB  31.34 GB reclaimable   <-- 100% dead
```

**31.34 GB of build cache is 100% reclaimable.** Docker 29 uses the containerd image
store, which is why this lives under `/var/lib/containerd` and not `/var/lib/docker`.

### 1.5 Network — not a constraint

```
ens5   rx 13.1 GB   tx 11.7 GB   over 15.8 days  ->  ~22 GB/month egress
Bundle includes 4 TB/month.
```

`docker stats` reports 249 GB / 46 GB for `litellm`, but that includes bridge-network
traffic to Postgres and Redis. Actual internet egress is the 11.7 GB above.

Upstream reachability from the box:

```
upstream host   aipilot-weld.vercel.app  ->  216.198.79.131 (Vercel anycast)
dns=4ms  connect=5ms  tls=41ms  ttfb=113ms
```

The upstream terminates **in Paris**, 5 ms from the VPS. This matters for region choice
(§7): the VPS→upstream leg is already optimal and should not be made worse.

### 1.6 Live traffic profile

From Caddy's access log, last 2 000 requests:

```
avg 91 ms   p50 20 ms   p95 330 ms   max 9.81 s
Requests in 24 h: ~2 300
```

This is a low-traffic deployment. Sizing decisions must reflect that, not peak anxiety.

---

## 2. Services and ports

| Service | Image / build | Port binding | State |
|---|---|---|---|
| `postgres` | postgres:16-alpine | `127.0.0.1:5432` | healthy, 18 h |
| `redis` | redis:7-alpine | none (internal) | healthy, 2 weeks |
| `litellm` | ghcr.io/berriai/litellm:v1.103.1 | `127.0.0.1:4000` | up 12 days, **no healthcheck** |
| `auth-edge` | built, `edge/` | `127.0.0.1:4001` (host net) | healthy |
| `caddy` | caddy:2-alpine | `*:80`, `*:443` (host net) | up 11 days, **no healthcheck** |
| `portal` | built, `portal/` | `127.0.0.1:3000` | healthy |
| `jobs` | built, `portal/` target `jobs` | none | running, **no healthcheck** |
| `engine` | **not running** — no image built | none (by design) | **absent** |
| `gateway-mock` | leftover | — | **exited 2 weeks ago**, still present |

Host-level processes outside Compose:

- `dockerd`, `containerd` — root
- `actions.runner.Louay0007-gateway.gateway-vps-prod` — GitHub self-hosted deploy runner, active since Oct 25
- `opencode serve` (pid 429130, user `ubuntu`, `127.0.0.1:49374`) — **running as a bare user process**, not systemd. `opencode-web.service` is `inactive` + `disabled`, yet the Caddy vhost and `code.15-224-52-176.sslip.io` DNS still exist.
- `systemd-resolved`, `snapd`, `amazon-ssm-agent`, `ModemManager`, `fwupd`, `multipathd`

`ModemManager`, `multipathd` and `fwupd` are desktop/laptop services with no purpose on
a cloud server. Small, but they are attack surface and noise.

### Firewall and access — nothing is protecting this box

```
ufw              inactive        <-- no host firewall at all
fail2ban         inactive        <-- no brute-force protection
CrowdSec         not installed
sshd             LISTEN 0.0.0.0:22        <-- SSH open to the entire internet
AWS security group: unknown / assumed permissive — must be verified in the Console
```

The only network control is that Docker publishes internal services to `127.0.0.1`.
That is good design, and it is the *only* thing standing between this box and the internet.

---

## 3. Configuration inventory

### 3.1 `docker-compose.yml` — settings that matter

| Setting | Value | Comment |
|---|---|---|
| `NUM_WORKERS` | `2` | Confirmed in `docker inspect`: `--num_workers=2`. Each worker loads the full router + Prisma → the 3.08 GB peak |
| `LITELLM_LOG` | `ERROR` | Correct; DEBUG is LiteLLM's #1 latency cause |
| `STORE_MODEL_IN_DB` | `True` | Required for the dynamic model list |
| `STORE_PROMPTS_IN_SPEND_LOGS` | **`True`** | **Conflicts with config** — see §4.3 |
| Postgres | no `command:` / no tuning | Runs on stock defaults |
| Any service | **no `logging:` block** | No log rotation anywhere |
| `caddy`, `auth-edge` | `network_mode: host` | Deliberate, documented, correct |
| `engine` | `ENGINE_TOKEN: ${ENGINE_TOKEN:?}` | Required at boot; container absent |
| `litellm`, `caddy`, `jobs` | no `healthcheck:` | Deploy gate uses `docker compose ps --status running` only |

### 3.2 Postgres tuning — stock defaults

```
shared_buffers        128MB     (should be ~25% of RAM)
work_mem              4MB
maintenance_work_mem  64MB
effective_cache_size  4GB
max_connections       100
connections in use    32 idle + 1 active
```

`shared_buffers = 128MB` on a 4 GB box means Postgres does almost all reads from the OS
page cache — which is exactly the cache that swap pressure evicts. This is a
double-penalty with §1.2.

### 3.3 Database size

| DB | Size | Notes |
|---|---|---|
| `litellm` | 788 MB | **773 MB is `LiteLLM_SpendLogs`, 5 310 rows** |
| `portal` | 17 MB | `usage_records` 3.1 MB / 2 781 rows |

5 310 rows occupying 773 MB = **~145 KB per row**, because every row contains the full
prompt and the full response.

### 3.4 `config/Caddyfile`

Four vhosts: `api.`, `zaino.` (portal), `admin.` (console), `code.` (opencode).

Findings:

1. **`encode zstd gzip` still applies to SSE on the API vhost.** This is
   PERFORMANCE-AUDIT finding #2, unfixed. Measured 10.4× worse token delivery
   (23.9 ms vs 2.3 ms median inter-chunk gap). One directive fixes it.
2. **Console IP allowlist removed.** Comment says `ADMIN_GATE_SECRET` is now the sole
   control. That is a single shared secret, 43 chars, on a public URL — no MFA, no IP
   gate. This is a deliberate change but it is a net security reduction.
3. `code.` vhost is live with DNS (`code.15-224-52-176.sslip.io`) but its upstream
   systemd unit is disabled. Dead surface.
4. No rate limiting on `/v1/*` — the token wall is the only limiter.

### 3.5 `config/litellm.yaml`

Audit findings #1, #3, #4 all still present:

| Setting | Value | Status |
|---|---|---|
| `reasoning_effort` | `max` on all 3 aliases | Audit #1/#4 unfixed — constrained `max_tokens` returns empty answers |
| `num_retries` | `6` (deployment) + `2` (router) + `2` (litellm) | Audit #3 unfixed — up to 24 upstream attempts |
| `default_max_parallel_requests` | `100` | On a box that OOMs at 3 GB |
| `success_callback` | `["prometheus"]` | **No Prometheus is running** — every callback is a no-op or a failed push |
| `store_prompts_in_spend_logs` | `false` | Overridden by the env var — see §4.3 |

### 3.6 Environment — the full map

28 variables on the VPS. Names and purpose only; no values reproduced here.

**Topology (4)**

| Var | Purpose | Trap |
|---|---|---|
| `API_DOMAIN` | `api.` vhost + Caddy | — |
| `PORTAL_DOMAIN` | portal vhost, `AUTH_URL` | Must match or Auth.js redirects off-host |
| `CONSOLE_DOMAIN` | admin vhost | No IP gate any more (§3.4) |
| `CODE_DOMAIN` | opencode vhost | Points at a **disabled** service |

**Secrets — must survive migration byte-for-byte (10)**

| Var | If lost / changed |
|---|---|
| `POSTGRES_PASSWORD` | **DB unreachable**, and it is baked into the `pgdata` volume init |
| `REDIS_PASSWORD` | cache down |
| `LITELLM_MASTER_KEY` | management API dead; portal cannot sync |
| `LITELLM_SALT_KEY` | **every stored provider credential becomes permanently unreadable.** Not in the pg_dump. Back up separately. |
| `AUTH_SECRET` | signs every user out |
| `CHAT_KEY_SECRET` | every sealed chat gateway key is lost → re-issue chat keys |
| `ADMIN_GATE_SECRET` | console becomes ungated (portal treats missing as *open*, not locked) |
| `BILLING_DEV_SECRET` | dev callbacks stop verifying |
| `SMTP_PASS` / `RESEND_API_KEY` | password reset + receipts stop |
| `ENGINE_TOKEN` | see below |

**Upstream (3)**

| Var | Note |
|---|---|
| `UPSTREAM_BASE_URL` | `aipilot-weld.vercel.app`, anycast, 5 ms from the box |
| `UPSTREAM_API_KEY` | all three aliases use this |
| `LITELLM_ANTHROPIC_DISABLE_URL_SUFFIX` | `false` on VPS, **`true` in the local `.env` — drift** |

**Vestigial / misleading (2)**

| Var | Problem |
|---|---|
| `GHOSTCLI_API_KEY` | Compose still declares `${GHOSTCLI_API_KEY:?set in .env}` — a **hard boot requirement** — but `litellm.yaml` no longer references it. Removing it breaks startup; leaving it is a phantom secret. Same bug class as the GHOSTCLI outage already documented in compose. |
| `ENGINE_TOKEN` | Set (64 chars) → `engineConfigured()` returns true → **the UI advertises attachments and search that always fail**, because no engine container exists |

**Billing / email (9)**

`BILLING_PROVIDER=d17`, `D17_RECEIVER_PHONE` (real merchant number), `D17_USD_TND_RATE=3.1`,
`EMAIL_TRANSPORT=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

Missing vs `.env.example` — these fall back to compose defaults, which is fine but is drift:
`PAYMENT_WINDOW_HOURS`, `AUTH_NUMBER_REGEX`, `D17_REVIEW_THRESHOLD`,
`D17_REVIEW_WINDOW_MINUTES`, `D17_MAX_PROOF_PER_HOUR`, `OPS_ALERT_EMAIL`.

**Other (2):** `LITELLM_VERSION=v1.103.1` (pinned, correct), `APP_URL` (compose derives it).

**Two env-level risks worth naming:**

- `.env.example` ships `ADMIN_GATE_SECRET=zainadmin`. A 9-character committed default for
  the *only* control on the staff console. Anyone who copies the example and forgets is wide open.
- `OPS_ALERT_EMAIL` is empty on the VPS → **job failures and anomaly alerts go nowhere.**

---

## 4. Findings, ranked

### 4.1 BLOCKER — deploys have been dead since 27 October

```
VPS HEAD         dcc30ac  feat(admin): manual plan grants + console UI/UX pass  (Oct 27)
local main       41681e6  perf(desktop): ...                                   (23 commits ahead)
VPS tree         112 dirty tracked files (94 modified, 18 deleted)
```

`.github/workflows/deploy.yml` step 2 is *"Refuse to deploy a dirty tree"*. It is doing
its job. Nothing has deployed in 7 days, including migrations `0026_chat.sql` and
`0027_chat_ui.sql`.

The runner is healthy and listening — it has simply had no acceptable work.

**This must be resolved before any migration**, or the new box inherits a broken state.

### 4.2 HIGH — builds are running on the production host

`/opt/gateway/desktop` (3.7 GB, untracked, 0 files in git) and `/opt/gateway/target`
(1.7 GB) are Rust/Tauri build output. 31 GB of containerd build cache. These are what
saturate CPU, exhaust swap and fill the disk. A production VPS should never compile Tauri.

### 4.3 HIGH — prompts and responses are being persisted, contrary to the config

```
litellm.yaml:  store_prompts_in_spend_logs: false
compose env:   STORE_PROMPTS_IN_SPEND_LOGS: "True"     <-- wins
verified:      5 310 / 5 310 rows have messages AND response
```

773 MB of customer conversation content in the database, on a box with no encryption at
rest, no off-site backup, and `ufw` disabled. This is both a bloat problem and a
data-protection problem.

### 4.4 HIGH — no backups run, ever

```
crontab -l (ubuntu)  no crontab
crontab -l (root)    no crontab
/etc/cron.d/         sysstat, e2scrub only
```

`scripts/backup.sh` is correct and complete — and **has never been scheduled**. The only
dumps are three manual tarballs from Nov 2, sitting on the same disk they are meant to
protect (417 MB × 3, two of them duplicates of each other).

`LITELLM_SALT_KEY` is not in the dump by design and is not backed up separately anywhere
visible. Losing it bricks every stored provider credential.

### 4.5 HIGH — no firewall, no brute-force protection

Covered in §2. `sshd` on `0.0.0.0:22`, `ufw` inactive, `fail2ban` inactive, and the AWS
security group is unverified.

### 4.6 MEDIUM — engine advertised but absent

`ENGINE_TOKEN` is set, the compose service is defined, the portal's client is wired — and
the container has never been built. `docker exec portal wget http://engine:8099` →
`bad address 'engine:8099'`. Users see attachment and search affordances that fail.

Either build and run it, or unset `ENGINE_TOKEN` so the UI hides itself (the client
explicitly supports that as a clean degraded state).

### 4.7 MEDIUM — no observability, and the configured one is a no-op

`litellm.yaml` declares `success_callback: ["prometheus"]` but nothing is listening.
There is no metrics, no log aggregation, no uptime check, no alerting. Job failures are
silent (`OPS_ALERT_EMAIL` empty).

### 4.8 MEDIUM — unbounded container logs

No `/etc/docker/daemon.json`, no `logging:` stanza in compose. Currently 102 MB, growing
without limit, on a disk that is 79% full.

### 4.9 LOW — leftover state

- `gateway-mock` container, exited 137, 2 weeks old
- `_rescue/` directory
- two 417 MB pre-deploy tarballs in `/opt/gateway`
- `/swapbuild` swapfile (2 GB) — a build-time artifact left mounted
- `opencode serve` running as a bare user process on `127.0.0.1:49374`
- `ModemManager`, `multipathd`, `fwupd` running on a server

### 4.10 LOW — audit findings never actioned

PERFORMANCE-AUDIT §2 (gzip on SSE) and §3/§4/§5 (retries, `reasoning_effort: max`) are
all still in the config. The gzip fix is one directive and 10× token delivery.

---

## 5. Target sizing — derived, not guessed

| Resource | Evidence | Requirement |
|---|---|---|
| **RAM** | 3.08 GB LiteLLM peak + 143 PG + 193 portal + 103 jobs + 60 misc ≈ **3.5 GB**, OOM on 3.7 GB | **8 GB floor.** 16 GB if builds or the engine will ever run on-box |
| **RAM (post-tuning)** | PG `shared_buffers` 2 GB + LiteLLM 3.2 GB + 0.5 GB services + 0.6 GB OS/Docker + 0.3 GB monitoring ≈ 6.6 GB | 8 GB is correct **only if** nothing is built on the box |
| **vCPU** | avg 3–5%, peaks 100% only during builds | **2 dedicated** beats 2 burstable. 4 preferred for deploy headroom |
| **Disk** | 61 GB used, 36 GB of it reclaimable → real working set ~25 GB + build churn | **100 GB floor**, 160 GB comfortable |
| **Traffic** | 22 GB/mo actual, 4 TB allowance | not a factor in any option |
| **Region** | upstream anycast terminates 5 ms away in Paris; client base Tunisia | Paris or Marseille. Avoid adding a hop |

**Minimum correct spec: 4 vCPU (non-burstable) / 8 GB / 100 GB NVMe / Paris-Marseille.**

---

## 6. Phase 0 — free performance before spending anything

Do these first. They cost $0 and may remove the need for the larger instance.

### 6.1 Reclaim disk (~36 GB)

```bash
# 31 GB of dead build cache
docker builder prune -af
docker system prune -af --volumes          # review the volume list first
# containerd snapshotter
sudo ctr -n moby content prune --help      # or: docker buildx prune --all
```

### 6.2 Remove artifacts that should never be on prod (~5.5 GB)

```bash
sudo rm -rf /opt/gateway/desktop /opt/gateway/target /opt/gateway/_rescue
docker rm -f gateway-mock
sudo find /opt/gateway -maxdepth 1 -name 'backup-*.tar.gz' -delete   # after §6.5
```

Expected: **17 GB free → ~55 GB free (72%)**, and the swap-in I/O pressure disappears
because containers stop competing with a nearly-full filesystem.

### 6.3 Consolidate swap

```bash
sudo swapoff /swapbuild && sudo rm /swapbuild
sudo fallocate -l 8G /swapfile2 && sudo chmod 600 /swapfile2
sudo mkswap /swapfile2 && sudo swapon /swapfile2
# then remove the /swapfile line from /etc/fstab
```

One 8 GB file, `vm.swappiness=10` (already set correctly in `/etc/sysctl.d/99-swap.conf`).

### 6.4 Tune Postgres

Add to `docker-compose.yml` under `postgres`:

```yaml
command:
  - postgres
  - -c
  - shared_buffers=2GB
  - -c
  - effective_cache_size=6GB
  - -c
  - work_mem=8MB
  - -c
  - maintenance_work_mem=256MB
  - -c
  - max_connections=100
  - -c
  - random_page_cost=1.1        # SSD, not spinning rust
```

### 6.5 Fix the backup gap — today, not after the migration

1. Schedule `scripts/backup.sh` (`17 3 * * *`), and verify `BACKUP_BUCKET` + AWS
   credentials exist — the script's last line is `aws s3 cp`, and there is no evidence it
   has ever run.
2. **Back up `LITELLM_SALT_KEY` and the whole `.env` separately**, encrypted, off-box.
   Without the salt the database dump is not restorable in practice.
3. Rotate the three 417 MB tarballs off the box.

### 6.6 Stop prompts being persisted

Set `STORE_PROMPTS_IN_SPEND_LOGS: "False"` in compose (matching `litellm.yaml`), restart
LiteLLM, then purge the existing content. This is a privacy fix as much as a disk fix —
it should not wait for the migration.

### 6.7 Resolve the deploy blocker

Do **not** `git checkout --` the 112 dirty files. Identify and commit what is real:

```bash
ssh gateway 'cd /opt/gateway && git diff > /tmp/vps-drift.patch'
scp gateway:/tmp/vps-drift.patch ./
# triage: which hunks are genuine fixes that only exist on the box?
```

The README already records this exact failure mode from Oct 27. Same fix: bring the diff
local, commit it properly, push. Then the deploy flows and the VPS catches up to `41681e6`
(including migrations 0026 and 0027).

### 6.8 Re-measure

After Phase 0, run for 48 h and check:

```bash
free -h                              # swap should be near zero
df -h /                              # >60% free
sar -u 1 30                          # steal should be ~0
docker stats --no-stream
```

**Decision point:** if swap stays at zero and peak RSS holds under 3.5 GB, an 8 GB
instance is sufficient and the 16 GB option is optional. If OOM reappears under a normal
deploy, buy 16 GB.

---

## 7. Hosting options

All prices are approximate monthly, on-demand, from the vendors' published tables; Hetzner
repriced on 15 June 2026 so verify before ordering.

| Option | Spec | Region | ≈ Cost | Burstable? | Verdict |
|---|---|---|---|---|---|
| **Current** — Lightsail Medium | 2 vCPU / 4 GB / 80 GB / 4 TB | Paris | **$24** | yes | The problem |
| **A** — Lightsail Large | 2 vCPU / 8 GB / 160 GB / 5 TB | Paris | **$44** | yes | Lowest-risk upgrade: snapshot-restore, same console, same IP mechanics. Still burstable, still only 2 cores |
| **B** — Lightsail XL | 4 vCPU / 16 GB / 320 GB / 6 TB | Paris | **$84** | yes | Removes RAM risk entirely. Still burstable |
| **C** — Hetzner CCX13 | **2 dedicated** / 8 GB / 80 GB / 20 TB | Nuremberg or Helsinki | **~$43** | **no** | Best price for dedicated cores. Disk is tight at 80 GB. Adds ~10–15 ms to Tunisian clients |
| **D** — Hetzner CCX23 | **4 dedicated** / 16 GB / 160 GB / 20 TB | Nuremberg or Helsinki | **~$86** | **no** | The "more performant" answer with no caveats except region |
| **E** — EC2 `t3a.large` | 2 vCPU / 8 GB + 100 GB gp3 | Paris | **~$74** | yes | AWS flexibility, no cost advantage over B |
| **F** — EC2 `t3a.xlarge` | 4 vCPU / 16 GB + 100 GB gp3 | Paris | **~$130** | yes | Expensive for this workload |
| **G** — OVH / Scaleway, Marseille | 4 vCPU / 8–16 GB | **Marseille** | ~$30–60 | varies | **Best client latency** — Marseille is ~10–15 ms closer to Tunisia than Paris |

### Recommendation

**Primary: Option A (Lightsail 8 GB, $44) — but only after Phase 0.**

Reasoning: Phase 0 removes the actual cause of the OOM (builds + full disk + swap). The
measured steady state is ~570 MB and the only 3 GB spike is LiteLLM, which is a
configuration question, not a capacity one. $44 keeps the migration to a snapshot restore
with no DNS surgery, no new provider, no new failure mode — and doubles RAM, doubles disk,
and adds a transfer allowance you will never touch.

**If you want "performant" without compromise: Option D (Hetzner CCX23, ~$86).**
Dedicated cores end the burstable-credit class of problem permanently, 16 GB makes the
LiteLLM spike a non-event, and 160 GB means the next build cache does not threaten prod.
The cost is roughly 5 paying Starter customers.

**If client latency is the priority over all else: Option G in Marseille.**
The one structural latency gain left is Tunisia→edge distance. Worth measuring with
`scripts/measure-latency.sh` from an actual Tunisian connection before committing.

**Do not** move to a bigger box without doing Phase 0 first — you would pay 2–4× to keep
the same four misconfigurations.

---

## 8. Open-source tooling to make the host manageable

Only what earns its memory. At this scale, every tool is a liability until it has proved
it catches something.

### Tier 1 — adopt now

| Tool | What it replaces | Cost | Why this one |
|---|---|---|---|
| **ufw** | nothing | ~0 MB | Native, one command. There is currently **no firewall**. Default-deny inbound except 22/80/443 |
| **Tailscale** (or plain WireGuard) | public SSH | ~40 MB | Removes `:22` from the internet entirely. Admin access over the tailnet; then `ufw` can drop 22. This is the single highest-value security change available |
| **CrowdSec** | fail2ban | ~80 MB | Behavioural detection with community IP blocklists, nftables-native. Catches SSH brute force **and** HTTP scanning/CVE probing against the public API. fail2ban is fine too — CrowdSec is better and equally easy |
| **restic** + **rclone** | `scripts/backup.sh` → S3 | ~30 MB | Encrypted, deduplicated, incremental, retention policies. Backs up to Backblaze B2 / Cloudflare R2 / a Hetzner Storage Box for ~$1–5/mo. **This is the most important item in this table** — you currently have zero backups |
| **Netdata** | nothing | ~150 MB | Single binary, zero-config, per-second host + container metrics, anomaly alerts, web UI. Gives you the memory/swap/disk dashboards you have been living without |
| **Uptime Kuma** | nothing | ~120 MB | One container, checks `api.`, `zaino.`, `admin.` from outside, alerts to email/Telegram. Catches "the deploy broke the portal" before a customer does |
| **Docker log rotation** | nothing | 0 MB | Not a tool — `/etc/docker/daemon.json` with `max-size: 10m`, `max-file: 3`, then `docker compose up -d` to recreate |
| **SOPS + age** | plaintext `.env` | ~5 MB | Encrypt `.env` and commit it. Makes disaster recovery possible without a password manager, and stops secrets being a hand-copied file on one box |

### Tier 2 — worth it, not urgent

| Tool | Use | Caveat |
|---|---|---|
| **Prometheus + Grafana + node_exporter + cAdvisor** | LiteLLM already emits these metrics; today they are dropped | ~600 MB–1 GB. Adopt only if you want per-tenant token/cost dashboards. Netdata covers host health more cheaply |
| **Loki + Promtail** | Log search across containers | Docker JSON + rotation is adequate at 2 300 req/day |
| **Dozzle** | Web log tailer | ~20 MB, replaces nothing, saves a lot of `docker logs` typing |
| **Diun** | Notifies when a pinned image has a newer tag | Notify-only. Never auto-update |
| **Trivy** | Image CVE scanning | Belongs in CI, not on the box |
| **WAL archiving** (`pgBackRest` or `archive_command` to restic) | Point-in-time recovery | The natural v2 after restic is in place. Daily logical dumps are the 80% |
| **Beszel** | Lighter alternative to Netdata (~30 MB) | Less depth; pick one, not both |

### Explicitly NOT recommended

| Tool | Why not |
|---|---|
| **Watchtower** | Auto-pulls `:latest` and restarts containers. This stack pins `v1.103.1` deliberately and deploys through CI. Auto-update would silently bypass both |
| **Coolify / Dokploy / CapRover** | Self-hosted PaaS. They would replace a working push-to-deploy pipeline with a UI-managed one, fight the hand-written compose file, and own the Caddy config. All cost, no gain here |
| **Portainer** | Duplicates `docker compose` without adding capability; adds a privileged web surface |
| **Kubernetes / Nomad** | One box, seven containers. Operationally absurd |
| **fail2ban AND CrowdSec together** | Pick one. They fight over the same firewall |
| **AIDE / auditd** | Real value, but the effort is better spent on backups first |

### Target box after Tier 1 (8 GB instance)

```
OS + Docker              600 MB
LiteLLM                  3 200 MB peak / 300 MB steady
Postgres                 2 500 MB (shared_buffers 2 GB)
portal + jobs            300 MB
caddy + edge + redis      60 MB
Netdata                   150 MB
Uptime Kuma               120 MB
CrowdSec + Tailscale      120 MB
------------------------------------------
budgeted peak            ~7.0 GB of 8 GB   <-- tight; this is why Option D exists
```

---

## 9. Migration runbook

Assumes Phase 0 is done and the deploy blocker is cleared.

### Phase 1 — pre-flight (1 h)

1. Confirm local `main` builds and all tests pass:
   ```bash
   make verify-config && cd portal && npm run typecheck && npx vitest run
   ```
2. Confirm the VPS has caught up to `41681e6` via the runner and migrations 0026/0027 applied.
3. Drop the DNS TTL on all four records to **60 s**, 24 h before cutover.
4. Inventory what must be carried (see §3.6 — ten secrets that must survive byte-for-byte).
5. Decide the `CODE_DOMAIN` question: if `opencode web` is not a service you use, delete
   the vhost, the DNS record, and the running user process rather than migrating them.

### Phase 2 — provision and harden the new host (2 h)

1. Provision the chosen instance in **the same region** (Paris/Marseille).
2. Create a non-root `ubuntu` user, SSH key only:
   ```bash
   # on the box, before anything else
   sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
   systemctl reload ssh
   ```
3. Install Tailscale, join the tailnet, then remove `:22` from the public path.
4. `ufw`:
   ```bash
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow in on tailscale0
   ufw allow 80,443/tcp
   ufw enable
   ```
5. **Verify the AWS security group** matches — ufw is useless if the group is open.
6. Docker + compose plugin, then `/etc/docker/daemon.json`:
   ```json
   { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
   ```
7. Swap: one 8 GB file, `vm.swappiness=10`.
8. Disable `ModemManager`, `multipathd`, `fwupd`.
9. Confirm no secrets have been copied yet. The box should be empty and clean.

### Phase 3 — install the toolchain (1 h)

Netdata → CrowdSec → Uptime Kuma → restic repo initialised with a **passphrase stored off-box**.
Point Uptime Kuma at the *old* host first, so it proves itself before cutover.

### Phase 4 — deploy the application (1 h)

1. Clone the repo, `make init` on the new box to generate its own local secrets — but
   **do not let it overwrite what you will copy**.
2. Transfer `.env` — over the tailnet, never through a paste buffer:
   ```bash
   socat -u FILE:/opt/gateway/.env TCP:<newbox-tailscale-ip>:9000
   socat -u TCP-LISTEN:9000,reuseaddr CREATE:/opt/gateway/.env
   ```
   Then `chmod 600`, and diff against the source to confirm byte equality.
3. Provision volumes, then restore both databases:
   ```bash
   docker compose up -d postgres redis
   # restore litellm + portal from the newest tarball (§6.5)
   ```
4. Bring up the rest: `make db-init && make db-migrate && docker compose up -d --build`
5. **Install the self-hosted GitHub runner** and update the workflow's
   `working-directory` if the path differs.

### Phase 5 — verify before cutover (1 h)

Run against the **new box's IP** with `--resolve`, not DNS:

```bash
curl -sS --resolve api.zaino.soon.it:443:<NEW_IP> https://api.zaino.soon.it/health/liveliness
curl -sS --resolve zaino.soon.it:443:<NEW_IP>    https://zaino.soon.it/api/health
```

Gates, all must pass:

| Gate | Command | Expected |
|---|---|---|
| Postgres wired | `make health` | Postgres OK, pricing wired |
| Gateway live | `curl /health/readiness` | 200 |
| Portal + DB | `curl /api/health` | `{"database":true}` |
| Real inference | `make smoke KEY=zn-…` | 17/17 |
| Metering | `make verify-metering` | passes |
| Plan grant | `make verify-grant` | passes |
| Auth | sign in via the portal | session lands on the right host |
| Email | request a password reset | delivery, not a log line |
| Backup | run restic, restore to scratch | drill passes |
| Token wall | burn one alias, then request it | `403 … for today` |
| TLS | `openssl s_client` | Let's Encrypt cert issued |

### Phase 6 — cutover (30 min, low traffic window)

1. Lower TTL already at 60 s.
2. Stop the old box's Caddy (or stop the stack) to prevent split-brain writes.
3. `make backup` on the **old** box one final time.
4. Restore that final dump into the new box.
5. Move the A records for all four hostnames.
6. Caddy on the new box obtains certificates (needs 80/443 reachable — verify the security group).
7. Re-point the GitHub runner registration if the runner was re-created; otherwise the old
   runner will still claim jobs. **Deregister the old runner.**

### Phase 7 — decommission

Keep the old instance **stopped, not terminated**, for 7 days. Then:
snapshot → verify restic holds everything → terminate.

---

## 10. Rollback

| Failure point | Action |
|---|---|
| During Phase 4–5 (before DNS) | Nothing to roll back. The old box is serving. Fix and retry |
| TLS will not issue | Old box still has valid certs until 15 Jan 2027. Move DNS back; the 60 s TTL makes this a 2-minute operation |
| After DNS (first hour) | Re-point A records to the old IP. Old box still holds its database — **but any write since cutover is lost**. This is why cutover is done in a low-traffic window with the old stack stopped |
| Data corruption discovered later | `make restore FILE=…` on the new box from the pre-cutover archive |
| Runner misbehaves | `make deploy HOST=…` is the documented rsync fallback and does not need GitHub |

**The rollback quality is set entirely by §6.5.** Right now there is no restorable backup,
so no migration can be rolled back safely. Fix backups before Phase 1, not after.

---

## 11. Decisions needed from you

1. **Budget.** $44 (Lightsail 8 GB), ~$86 (Hetzner 16 GB dedicated), or ~$30–60 (Marseille,
   best latency)? This determines the whole of §7.
2. **Region priority.** Is shaving 10–15 ms off Tunisian client latency worth leaving AWS?
   Measure with `scripts/measure-latency.sh` from a real Tunisian connection first.
3. **Phase 0 first, or migrate now?** My recommendation is Phase 0 — it is free and it may
   make the 8 GB option correct. Migrating first means paying to carry the same four bugs.
4. **The 112 dirty files.** Who triages them? They are the reason nothing has deployed in
   7 days, and they cannot be blindly discarded.
5. **`opencode web`.** Keep it (and migrate it) or delete the vhost, DNS and process?
   It is currently a public TLS vhost pointing at a disabled unit.
6. **Engine.** Build and run it, or unset `ENGINE_TOKEN` and stop advertising the feature?
7. **Prompt storage.** Confirm `STORE_PROMPTS_IN_SPEND_LOGS=False` is intended, and that
   the 773 MB of existing prompt data should be purged.

---

## 12. Sequence, if you want one line

```
Phase 0 (free, ~3 h)  →  decide budget  →  fix deploy blocker  →  provision + harden
   →  toolchain  →  deploy  →  verify  →  cutover  →  7 days  →  decommission
```

Phase 0 and the deploy blocker are independent of the migration decision and should start
regardless of which instance you eventually buy.
