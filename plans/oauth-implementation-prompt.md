# Implementation prompt — own OAuth (Google, GitHub, Apple) in the Zaino portal

**Paste this whole file as the first message of a session opened on
`/Users/user/Workspace/gateway`.**

---

## Objective

Add Google, GitHub and Apple sign-in to `portal/`, implemented inside this
repository. No external identity service (no Zitadel, no Keycloak, no Auth0,
no Clerk). The existing email-and-password sign-in must keep working exactly as
it does today.

Read `plans/oauth-own-implementation.md` first — it is the design, and it
contains the resolution rules, the three providers' response-shape differences,
and the security constraints. This prompt is the execution brief.

## The codebase you are entering

**Next.js 16 portal** at `portal/`, Postgres via Drizzle, Auth.js v5
(`next-auth@5.0.0-beta.32`, pinned exactly) in `portal/auth.ts`.

Read these before writing anything:

| File | Why |
|---|---|
| `portal/auth.ts` | 320 lines. Credentials provider, JWT session, `jwt`/`session` callbacks, events, logger. Your providers go into the `providers` array; **the callbacks do not need to change**. |
| `portal/lib/auth/authorize.ts` | 397 lines. `currentUser()`, `requireActiveOrg()`, `requireStaff()`, session freshness. This is authorization — the session cookie alone is not it. |
| `portal/lib/auth/create-user.ts` | 95 lines. The ONE code path that creates a user: auth identity + credentials + domain mirror, in one transaction. |
| `portal/lib/auth/verify-email.ts` | 199 lines. Your email verification. Reuse it; do not replace it. |
| `portal/lib/auth/password.ts` | scrypt, 12-char minimum, timing-safe verify. |
| `portal/lib/auth/provision.ts` | 165 lines. First-login provisioning: org, owner membership, LiteLLM team. Runs on first authenticated render. |
| `portal/db/schema.ts` | `auth_users`, `auth_accounts` (already the OAuth shape, unused since Clerk), `users` (the domain mirror — authoritative for all product logic), `auth_verification_tokens`. |
| `portal/lib/auth/throttle.ts` | Postgres-backed login throttle. Decide explicitly whether OAuth callbacks are throttled. |
| `portal/components/auth/sign-in-form.tsx` | Where the provider buttons go. |

Two identity records exist per user and the distinction is load-bearing:
`auth_users.id` is what Auth.js signs in; `users.id` is the domain mirror that
every product read uses. They are bridged by email in `authorize.ts`. Get this
wrong and provisioning, keys and billing break.

## Invariants — do not break

1. **The domain mirror is authoritative.** Every new identity must produce a
   `users` row in the same transaction. An `auth_users` row without a mirror is
   a user who can sign in but has no product row; the reverse is a dead account.
2. **Server-side authorization on every mutation.** Session presence is not
   permission. UI hiding is not authorization.
3. **No account takeover.** Link accounts only when the provider says the email
   is verified, and only when no other identity owns that address. Leave
   `allowDangerousEmailAccountLinking` off.
4. **Your email verification still gates sensitive actions.** A provider's
   "verified" claim informs the mirror; it does not replace your gate.
5. **Never log** codes, access/id/refresh tokens, the Apple `.p8`, or the PKCE
   verifier.
6. **Alias-only surfaces** — no upstream model name in anything customer-facing
   (unrelated to OAuth, but it is enforced by tests and easy to trip).

## Deliverables, in order

### 1. Migration `portal/db/migrations/0041_oauth_identity.sql`

Per `plans/oauth-own-implementation.md` §2.2:
- unique index on `lower(auth_users.email)`
- `auth_accounts.provider_email`, `.provider_email_verified`, `.provider_login`
- `auth_users.email_is_private_relay` (default false)
- `auth_users.signup_method` (default `'password'`), with a guard that it is one
  of `password|google|github|apple`

Forward-only, guards that `RAISE EXCEPTION` on violation, matching the style of
`0039_pool_totals.sql`.

### 2. `portal/lib/auth/oauth/types.ts`

The `OAuthProvider` interface exactly as in §3 of the design doc.

### 3. `portal/lib/auth/oauth/google.ts`

One `userinfo` call. `email_verified` is a **boolean**. `providerAccountId` is
`sub`.

### 4. `portal/lib/auth/oauth/github.ts`

**Two calls.** `/user` gives `id`, `login`, `name`, `avatar_url` and
`email: null` when the address is private. `/user/emails` gives the list; take
the `primary && verified` entry, else the identity is unverified.
`providerAccountId` is the **numeric `id`**, never `login` (logins rename).

### 5. `portal/lib/auth/oauth/apple.ts`

No userinfo endpoint. Identity comes from the `id_token`, whose **signature must
be verified** against `https://appleid.apple.com/auth/keys` (check `aud` =
Services ID, `iss` = `https://appleid.apple.com`). `email_verified` is the
**string** `"true"`. The client secret is an **ES256 JWT you mint** from the
`.p8` with `iss`=Team ID, `sub`=Services ID, `exp` ≤ 6 months — and it must be
re-minted before expiry, so it cannot be a static env value. The user's name
arrives **once**, in the POST body at first consent; persist it there.

### 6. `portal/lib/auth/oauth/resolve.ts` — the most important file

Implements §2.3 exactly:

```
1. (provider, providerAccountId) in auth_accounts -> that user. The ONLY
   path that signs in.
2. else, same email AND our mirror verified AND provider email verified
   -> link (insert auth_accounts), never create a second user
3. else -> create auth_users + credentials-less identity + domain mirror,
   signup_method = provider; email_verified_at only if the provider says so
4. provider email unverified -> never auto-link
```

Use `createLocalUser`'s transaction shape as the model, but it requires a
password — either add a `password?: string` option to it (preferred: one code
path for "create a user") or add a sibling `createOAuthUser` that reuses the
same transaction body. **Do not paste a third copy of that transaction.**

### 7. Wire into `portal/auth.ts`

One `OAuthConfig` per provider, with `checks: ['state', 'pkce']`, a total
`profile()` that never throws on a missing claim, and
`allowDangerousEmailAccountLinking` absent. **Do not change the `jwt`,
`session`, `events` or `logger` callbacks** — they key off `user.id`, which the
OAuth path supplies identically.

Register `auth_accounts` writes in the `signIn` event or in `resolve.ts`
(prefer `resolve.ts`: the event fires after the JWT is minted, too late to
decide linking).

### 8. UI — `portal/components/auth/sign-in-form.tsx` and the sign-up form

One button per provider **whose env vars are set**. Text buttons
("Continue with Google"), no provider logos — Google and Apple both require
licensed button assets and a hand-drawn logo is a brand violation. One
"or continue with email" divider.

### 9. Close the verification gap (§6.3 of the design)

`requireVerifiedEmail` gates keys and checkout but **not** chat or trial
redemption. Add it to `portal/app/api/trial/redeem/route.ts` (around line 44)
and `portal/app/api/chat/route.ts` (around line 200), with the existing 403
copy. This becomes sharper with social login, where an unverified provider
email is a normal state.

### 10. Env documentation

`portal/.env.example` — document all seven variables, including the Apple
newline trap (a PEM pasted unquoted into `.env` is the most common deploy
failure in this feature).

## Tests you must add

Unit, no network:
- `resolveIdentity()` across all six cases, especially **unverified email must
  not link**, and **an existing account's email must not be rewritten** by a
  new provider's different address.
- Each adapter against fixture payloads: GitHub `email: null`; Apple
  `email_verified: "true"` as a string and `is_private_email: "true"`.
- Apple secret JWT: `iss`/`sub`/`aud` correct, `exp` ≤ 6 months, ES256.
- State comparison is constant-time and rejects a mismatch.

Integration, local callback server, no real provider:
- Missing `oauth_pending` cookie → 400, not 500.
- `?error=access_denied` → redirect to `/sign-in`, no error page.
- Cookie deleted on success **and** failure.
- Callback twice → one `auth_accounts` row, one `users` row.

## Verification

```bash
cd portal && npx tsc --noEmit
cd portal && npx vitest run
```

The suite is at **720 tests** today. It must be green, and your additions must
be in it — a provider that "works in the browser" is not done.

Manual, once per provider, because these cannot be automated:
- Google consent screen **published**, not in Testing (otherwise only listed
  emails can sign in — the classic "works for me" failure).
- Callback URLs match **exactly**, no trailing slash.
- Apple: first-ever consent stores the name.

## What NOT to do

- Do not add `allowDangerousEmailAccountLinking`.
- Do not replace `lib/auth/verify-email.ts` with a provider's claim.
- Do not change the JWT callbacks or the session strategy.
- Do not touch the gateway, the desktop app, or `auth-edge`.
- Do not add a dependency — `next-auth` already does state, PKCE and the token
  exchange.
- Do not log any token, code or secret.

## Report back

State plainly: which providers work end to end, which you could not test and
why, and anything in the design doc that turned out to be wrong. An honest gap
list is worth more than a green summary.
