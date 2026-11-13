# Deploy — push to `main`, nothing else

One path: a push to `main` starts `.github/workflows/deploy.yml` on the
self-hosted runner that lives on the production box itself. There is no
`workflow_dispatch`-only mode and no manual rsync in normal operation
(`make deploy` still exists for a first-time bootstrap).

## Where it runs

| | |
|---|---|
| Host | production box, `zaino.soon.it` (197.5.133.66) |
| Project root | `/opt/gateway` — owned by `ubuntu`, checked out on `main` |
| Runner | `/opt/actions-runner`, systemd unit `actions.runner.Louay0007-gateway.gateway-db-prod` |
| Runner label | `gateway-new` — carried ONLY by that runner |
| Work dir | `/opt/gateway-runner-work` |

The label is the whole safety mechanism. Two boxes once advertised the same
default labels, so GitHub could hand a push to either one — and the job then
deployed the wrong host or failed on the other box's dirty tree. `gateway-new`
is unique to the production runner, so `runs-on` can land nowhere else.

## What a deploy does, in order

1. Refuses to run if tracked files on the box differ from git. Prod is never
   hand-edited; the whole tree is `ubuntu`-owned and matches `origin/main`.
2. `git merge --ff-only origin/main` — a diverged history fails loudly rather
   than silently creating a merge commit on the deploy box.
3. `make db-init && make db-migrate` — migrations are idempotent and
   forward-only, and run **before** the new code is up, so a deploy never
   serves code that expects a column the database does not have yet.
4. `docker compose up -d --build`
5. Asserts, with retries: LiteLLM readiness 200 on `127.0.0.1:4000`, portal
   `/api/health` reporting `database:true`, `jobs` running, engine
   `/health` answering `ok:true` from inside the compose network, and SearXNG
   answering a real JSON search. `make health` only prints, so these are the
   steps that actually mark a broken deploy red.

## Requirements on the host that are easy to lose

These are not part of the repo and a rebuilt box will not have them:

- `make` installed (the workflow calls `make db-init`).
- `ubuntu` in the `docker` group, or `docker` calls fail with permission denied.
- `/opt/gateway` entirely owned by `ubuntu:ubuntu`. Root-owned files in there
  break the runner first and the deploy second.
- `/opt/gateway-runner-work` existing and owned by `ubuntu`.

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
