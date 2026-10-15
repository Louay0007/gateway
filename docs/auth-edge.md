# The auth edge — `zn-` keys

Every key this product issues starts with `zn-`. This document explains why
that is not as simple as changing a string, and what the `auth-edge` service
does and why it is shaped the way it is.

## The short version

The customer holds `zn-<body>`. LiteLLM stores `sk-<body>`. Both have the
**same random body**; only the 3-character prefix differs, and `auth-edge`
restores the gateway's prefix on the way in.

```
client ──zn-<body>──▶ Caddy ──zn-<body>──▶ auth-edge ──sk-<body>──▶ LiteLLM
```

## Why the gateway cannot just be told to use `zn-`

LiteLLM `sk-` is **structural, not cosmetic**. Two findings, both verified
against the pinned `v1.103.1` image rather than assumed:

1. **`/key/generate` hard-codes it.** A caller-supplied `key` must satisfy
   `data.key.startswith("sk-")` (key_management_endpoints.py) or the request
   is rejected with a 400. There is no setting for it — `LITELLM_KEY_PREFIX`
   does not exist.

2. **Authentication depends on it.** Keys are stored as `sha256(plaintext)`
   and looked up by hash. But the normalizer (`proxy/_types.py`) only hashes a
   value **when it starts with `sk-`**:

   ```python
   if normalized.startswith("sk-"):
       return hash_token(normalized)
   # otherwise: treated as an already-hashed token, used verbatim
   ```

   A `zn-` value would therefore skip hashing and be compared against a
   column holding a sha256. It could never match. `sk-` is additionally
   branched on in `/key/block`, key-info, and two spend-tracking paths.

So the credential itself cannot change. What *can* change is which prefix the
customer is shown — provided the two forms share a body, which is exactly why
the **portal** generates the randomness rather than the gateway.

## Why not just patch LiteLLM?

Because the patch would land in `_types.py`'s normalizer and in spend
tracking — the code that enforces budgets. A mistake there does not fail
loudly; it fails as *unmetered usage*. The prefix substitution does the same
job while leaving every line of the money path untouched.

The translation was also tried at the Caddy layer first and **rejected on
evidence**: with Caddy 2.11.7's Caddyfile, `header_up` with a `.replace.`
placeholder silently *drops the header*, and a plain placeholder forwards the
unexpanded literal. `request_header` and `map` are not available in this
build. Both failure modes are silent — the request would simply become
anonymous, i.e. unmetered — so it is not shippable.

## The edge's rules

From `edge/server.mjs`, in priority order:

- **Fail closed.** An unreachable gateway returns 502, never 200. A proxy that
  succeeds when the gateway did not is precisely the unmetered request this
  product exists to prevent. An unrecognised credential is passed through
  untouched for the gateway to reject — never guessed at, never forged.
- **Never log a credential.** Logs carry method, path, status, duration and a
  boolean saying whether a prefix was substituted. Not the value, not its
  length, not a slice of it.
- **Stream.** No buffering, no body mutation, framing passed through
  untouched, so `text/event-stream` arrives token by token.
- **Refuse a bodiless `zn-` key.** `zn-short` becomes a 401 from the edge
  (`auth_edge_error`), never `sk-short` — which would be a syntactically
  valid credential containing no secret.
- **Deny the management surface**, mirroring the `@mgmt` matcher in
  `config/Caddyfile`. Caddy is authoritative; this is defence in depth.

## Backwards compatibility

Keys issued before this change keep working. `toGatewayKey()` returns any
non-`zn-` value unchanged, so `sk-` keys, the LiteLLM master key, JWTs and
hashed token ids all pass through exactly as before. Nothing breaks on deploy.

`/admin` still talks to LiteLLM directly (port 4000), not through the edge: it
speaks the master key, not a customer key, so the ops console keeps one fewer
hop in its path.

## Running it

```bash
# locally
docker compose up -d auth-edge
curl -s 127.0.0.1:4001/__edge/health

# the whole loop, by hand
curl -H "Authorization: Bearer zn-…" https://api.yourdomain/v1/models
```

It binds `127.0.0.1` only and is reachable exclusively from Caddy on the same
host. If you ever find it bound to a routable interface, that is a bug — it
would bypass the edge's management-surface denials.

## Testing

- `portal/tests/key-format.test.ts` — minting, prefix substitution,
  round-trip, and the "one body, two prefixes" invariant.
- `portal/tests/auth-edge.test.mjs` — the real entry point against a stand-in
  gateway: substitution, SSE not buffered, request body forwarded, management
  denied, legacy `sk-` keys unaffected, and **fail-closed** against a dead
  upstream.

Both run under `npm test` in `portal/`.

## Gotchas worth knowing

- **An internal caller talking to LiteLLM's port directly must present the
  gateway form.** The edge is on the external path only. `verify-metering`
  calls `toGatewayKey(plaintext)` for exactly this reason; sending `zn-` there
  yields a 401 that reads like a broken key rather than a wrong door.
- **`sha256(zn-…)` ≠ `sha256(sk-…)`.** The prefix is part of the hashed
  input. The portal stores the hash of the *customer* form; LiteLLM keeps its
  own `sha256(sk-…)` in `litellm_key_hash`, and nothing compares the two.
- **Caddy does not reload when its bind-mounted Caddyfile changes.** Restart
  it, or the new `reverse_proxy` target silently does nothing.