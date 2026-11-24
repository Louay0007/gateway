# claude-desktop-aliases — review

Branch `claude-desktop-aliases`, `HEAD` = `5b95f8e`. Working tree clean except untracked `.agents/`.
Diff reviewed: `22babda^...HEAD` (7 files, +162/-6 over `22babda`; the whole branch adds the four alias blocks).

## Verdict: APPROVED

## Requirements check

| Brief requirement | Status |
|---|---|
| Translate `claude-*` → tier alias before LiteLLM | Met — `edge/server.mjs:149-155` (`CLAUDE_ALIAS`), applied at `:486-491` |
| Value is the TIER ALIAS, not an upstream name | Met — `claude-fast: 'fast'` |
| Comment explains tier-alias / single-pass / loop-on-second-pass | Met — `edge/server.mjs:138-148` |
| `/v1/messages`: rewrite after `sanitizeRequest`, recompute `bodyBuf`, update content-length | Met — `:478-500` |
| No `modelRejection` on `/v1/messages` | Met — unchanged, still no call on that path |
| PDF-block rewrite preserved | Met — `sanitizeRequest` still runs first (`:478`); verified a nested `tool_result` PDF is still rewritten and `model` survives |
| `node:assert` test: mapping, resolve+body, second-pass no-op, unknown passthrough | Met — `edge/alias.test.mjs`, 6/6 pass |

## Deviations from the brief, both correct

**1. The four entries went into a new `CLAUDE_ALIAS` map, not `MODEL_ALIAS`.** The brief's edit 1 literally says "add the four claude-\* entries" to the alias map and separately requires single-pass safety. Putting `claude-fast: 'fast'` into `MODEL_ALIAS` alongside `fast: 'haiku-5.5'` is exactly the two-pass loop the brief forbids — a lookup of `claude-fast` would yield `fast`, a key in the same map. The coder split the maps and made `resolveModelAlias` return before the `MODEL_ALIAS` lookup (`:203-207`). This satisfies the goal (LiteLLM sees `fast`) and the stated safety property. The design doc at `.agents/tasks/claude-desktop-aliases/design.md:155` independently reached the same conclusion.

**2. `/v1/chat/completions` and the `/v1/responses` shim also resolve `claude-*`** (commits `2d316c0`, `5b95f8e`). Outside the brief's stated edit surface, but not a behavior regression: these are the paths where `modelRejection` runs, and `claude-*` was previously a guaranteed 400 there. Resolution lands on the tier alias, never the upstream name (`:735-738`), so no allowlist is widened and no 403 is introduced. This is additive and consistent with the endpoint-agnostic goal in the original request.

## Production behavior verified

Single-pass across all four names, `EDGE_RESOLVE_ALIASES` unset (production default):

```
claude-fast -> fast      claude-smart -> smart
claude-frontier -> frontier   claude-fable -> fable
fast -> fast   smart -> smart   frontier -> frontier   fable -> fable
```

- **Four existing aliases untouched.** `MODEL_ALIAS` (`:129-134`) is byte-identical. With `EDGE_RESOLVE_ALIASES` off, tier aliases forward unchanged; with it on, `fast → haiku-5.5` as before. Tier-alias passthrough is unchanged on both settings.
- **No loop.** `requestAlias` (`:184-186`) is one object lookup on `CLAUDE_ALIAS`; it never consults `MODEL_ALIAS` and its result is never re-looked-up. `resolveModelAlias(body(claude-fast))` then re-feeding the output yields `fast` again, not `haiku-5.5`.
- **`resolveModelAlias` mutates the forwarded body** — `parsed.model = alias` before `JSON.stringify` (`:205`). Verified against the returned buffer.
- **content-length** recomputed from the mutated buffer at `:499` on `/v1/messages` and `:505` on `/v1/chat/completions`. The `:502-503` reordering in the diff (moving the assignment below `requestedModel = resolved.model`) is cosmetic — both lines run before the upstream request is built at `:518`.
- **`RESOLVE_ALIASES` still the gate** for tier→upstream rewriting on `/v1/chat/completions` (`:206`) and the shim (`:727`). Deliberately not the gate for `claude-*`, which is a routing name the edge must always translate or the request 400s.

## Constraint files

`git status --short` and `git diff --name-only` on `config/Caddyfile`, `.github/`, `.env`, `portal/lib/litellm/client.ts`: all clean/untouched. `config/litellm.yaml` changed only in the pre-existing commit `22babda` (four `model_list` entries), which the brief treats as the existing branch content, not new work. No DB migration. No allowlist widened — `allowlistFor` (`client.ts:291-293`) still returns only the tier aliases.

## Verification evidence (from commit messages, not re-run)

- `node --check edge/server.mjs` → CHECK_OK
- `node --test edge/alias.test.mjs` → 6 tests, 6 pass
- `make verify-config` → YAML OK (5 files), overlay merges, scripts OK
- `cd portal && npx vitest run` → 67 files, 1070 tests pass

I re-ran only `edge/alias.test.mjs` (6/6) as a spot-check on the central claim.

## Notes, not blockers

- `portal/tests/auth-edge.test.mjs:202-235` asserts `status !== 400` and accepts `403/429/502`. On `/v1/messages` a `claude-*` name did not 400 before this change either, so those two tests would pass without the rewrite. The real proof is `edge/alias.test.mjs`, which asserts the forwarded body. Test strength only; no production impact.
- The `auth-edge.test.mjs` header comment (lines 203-206) still describes the pre-fix two-pass model (`claude-fast` → `fast` → `haiku-5.5`), contradicting the shipped single-pass behavior. Comment only.
