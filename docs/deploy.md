# Deploy — push to `main`, nothing else

One path: a push to `main` starts `.github/workflows/deploy.yml` on the
self-hosted runner that lives on the production box itself. There is no
`workflow_dispatch`-only mode and no manual rsync in normal operation
(`make deploy` still exists for a first-time bootstrap).

## Where it runs

| | |
|---|---|
| Host | production box `event-toolbox-db`, `197.5.133.66` (`zaino.soon.it`, `api.zaino.soon.it`) |
| Project root | `/opt/gateway` — owned by `ubuntu`, checked out on `main` |
| Runner | `/opt/actions-runner`, systemd unit `actions.runner.Louay0007-gateway.gateway-db-prod` |
| Runner label | `gateway-new` — carried ONLY by that runner |
| Work dir | `/opt/gateway-runner-work` |

The former boxes `15.188.66.155` and `15.224.52.176` are decommissioned and
refuse connections on `:22`. Nothing deploys to them, and no config should
name them.

The label is the routing mechanism. **The IP assertion in the workflow's first
step is the proof.** `runs-on: [self-hosted, linux, x64, gateway-new]` selects
a registration, and a registration can be re-created on the wrong host by
anyone with shell access to it. So the job's first step checks
`hostname -I` for `197.5.133.66` and fails with the address it actually found.
Without that check, a job on the wrong box would rebuild a stack nobody
reaches and still report green.

## What a deploy does, in order

1. **Asserts the target** — `hostname -I` must contain `197.5.133.66`, or the run
   dies before touching anything.
2. Refuses to run if tracked files on the box differ from git. Prod is never
   hand-edited; the whole tree is `ubuntu`-owned and matches `origin/main`.
3. `git merge --ff-only origin/main` — a diverged history fails loudly rather
   than silently creating a merge commit on the deploy box.
4. `make db-init && make db-migrate` — migrations are idempotent and
   forward-only, and run **before** the new code is up, so a deploy never
   serves code that expects a column the database does not have yet.
5. `make verify-caddy` — a Caddyfile parse error does not fail the build; the
   stack starts and Caddy fails to load its config at reload, after a green
   `docker compose up`. This catches it first.
6. `docker compose up -d --build`
7. `docker compose restart litellm` — `litellm.yaml` is a bind mount, so a
   config edit does not change the image and compose leaves the process alone.
   Skipping this once left production answering `400 Invalid model name` for
   an hour with the correct YAML on disk.
8. Asserts the gateway loaded ≥ 8 model groups from `/model/info`.
9. `make health` (prints only — it exits 0 on FAIL).
10. Asserts, with retries: LiteLLM readiness 200 on `127.0.0.1:4000`, portal
    `/api/health` reporting `database:true`, `jobs` running, engine `/health`
    answering `ok:true` from inside the compose network, and SearXNG answering
    a real JSON search. These are the steps that mark a broken deploy red.

## Requirements on the host that are easy to lose

These are not part of the repo and a rebuilt box will not have them:

- `make` installed (the workflow calls `make db-init`).
- `ubuntu` in the `docker` group, or `docker` calls fail with permission denied.
- `/opt/gateway` entirely owned by `ubuntu:ubuntu`. Root-owned files in there
  break the runner first and the deploy second.
- `/opt/gateway-runner-work` existing and owned by `ubuntu`.
- The runner registered with the **`gateway-new`** label, on `197.5.133.66`.

Verified on `event-toolbox-db`, 2026-11-24: `make` 4.3, `ubuntu` in
`adm cdrom sudo dip lxd docker`, `/opt/gateway` and `/opt/gateway-runner-work`
both `ubuntu:ubuntu`, `.env` present at mode 600, all nine containers up.

## Recovery

A failed deploy leaves `main` checked out at the last good commit only if the
merge step failed; otherwise the code is new and the health gate is what
failed. Read the failed step, then re-run the workflow — it is safe to repeat,
because every step is either idempotent or a fast-forward.

To re-run by hand:

```bash
gh workflow run deploy.yml --ref main
```

Do not deploy Dokploy or any other PaaS on this host: Caddy owns `:80`/`:443`
with host networking, and the portal occupies `127.0.0.1:3000`, so Dokploy's
installer refuses to run and its own Traefik would fight Caddy for the edge.
