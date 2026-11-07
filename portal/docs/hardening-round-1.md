# Gaps fixed (round 1)

All eight items from the audit, plus the tests that pin them.

## 1. D17 writes now rank-check staff

`lib/admin/gate.ts` grew `requireOperator(required)`. Gate-only operator →
passes (the shared secret is this deployment's operator credential and
carries no rank). Signed-in staff → held to their role: approve needs
`support`, reject needs `admin`. `resolveActorId()` is gone; the two routes
call `requireOperator` once and use its return value as the actor id.

The UI matches now: `/admin/d17` resolves the role with the same
`?? "owner"` fallback the layout uses, and passes `canApprove` as well as
`canReject`, so no button is offered that the route would 403.

`requireGateOrStaff`'s docstring said gate-only must not change state while
three other files said the opposite. Rewritten to state the real rule.

## 2. `/api/admin/gate` is throttled, and the oracle is gone

10 attempts / 15 min per IP (`lib/api/ratelimit.ts`, reusing
`auth_login_attempts` — no migration). 429 with `Retry-After`.
An unset `ADMIN_GATE_SECRET` now logs server-side and answers the same
401 `{ error: { code: "unauthorized", message: "Invalid code" } }` as a
wrong code; there is no 503 telling a prober whether the secret is set.
The secret is read per request instead of at module load.

Both consumers (`app/admin/page.tsx`, `config/admin-gate.html`) read
`data.error.message` and still accept a bare string.

## 3. `/api/trial/redeem` on the shared envelope

zod body, `runtime`/`dynamic`, `jsonError`/`errorResponse`, and
`gone`/410 added to the code set for `code_expired`. `redeem-form.tsx`
reads `data.error.message` first.

## 4. Scheduled prompts hit the plan wall

`lib/chat/wall.ts` holds the wall logic once (`wallReason` for the job,
`wallRefusal` for routes). `/api/chat` now calls the shared version.
`POST /api/chat/scheduled` checks it for the alias it will run;
`PATCH` checks when `alias` changes; `lib/chat/schedule-run.ts` checks
again at run time, since a plan can lapse between CRUD and execution.

## 5. Share revoke uses its `[id]`

`DELETE .../share` validates the conversation UUID (404) and passes it to
`revokeShare`, which now scopes by `conversation_id` as well as org+user.

## 6. Screenshot route

UUID guard → 404 before the query; `ENOENT` → 404 instead of 500.

## 7. Status + GET org

`POST /api/attachments` → 201 on create, 200 on the dedupe hit.
`GET /api/orgs/[id]` added, mirroring the list route's shape.

## 8. Generic throttling

`/api/chat` 30/min per user, `/api/attachments` 20/min per user, both 429 +
`Retry-After`. Deliberately separate from the token wall: this is a burst
limit, not a budget.

## Tests

- `tests/wall-and-envelope.test.ts` — wall branches, every error code's
  status, the `internal`/`upstream` message replacement, rank ladder.
- `e2e/api-hardening.spec.ts` — the gate's 401/429/200 paths, anonymous D17
  writes, malformed and missing screenshot ids, the trial envelope, the
  scheduled wall, share-revoke scoping, and `GET /api/orgs/[id]`.
