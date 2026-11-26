# Plan — own OAuth for Google, GitHub and Apple

> **STATUS (2026-11-26): Apple was removed from the shipped product.**
> Google and GitHub are live. Apple needed a paid Developer Program
> membership, a `.p8` key that can be downloaded once, a client secret minted
> per request, and a domain-association file that made it production-only.
> The adapter, its tests, its four `APPLE_*` variables, its icon and its
> `ProviderId` are all gone. Everything below about Apple is retained as the
> design record for re-adding it; read `§1.3` before doing so.

**Written:** 2026-11-15
**Decision:** implement the OAuth 2.0 / OIDC authorization-code flow in this
repository. No external identity service, no provider SDK, no third-party auth
vendor. `auth.ts` gains real providers next to the existing Credentials one.

---

## 0. What "own OAuth" actually means, and what it does not

You cannot write the Google or GitHub *server*. What you can own, and what this
plan builds, is every part of the exchange that happens on your side:

```
  you build ─────────────────────────────────────────────────────────────┐
    the consent redirect        state + PKCE generation                  │
    the callback handler        code → token exchange                    │
    the provider adapter        3 different response shapes → 1 identity │
    account linking             "same verified email" policy             │
    session minting             your existing JWT + checklist            │
    email verification          your existing token flow                 │
  ──────────────────────────────────────────────────────────────────────┘
  the provider owns ────────────────────────────────────────────────────┐
    the login page              hosted by Google / GitHub / Apple        │
    the email verification      for accounts THEY host                   │
  ──────────────────────────────────────────────────────────────────────┘
```

`next-auth` already does exactly this and is in your dependency tree. Two
honest options, and this plan recommends the first:

- **Option A (recommended): custom `OAuthConfig` providers in `auth.ts`.** You
  write the endpoint URLs, scopes, `authorize` params and `profile` mapping —
  i.e. all the provider-specific logic — and Auth.js runs the state check, PKCE,
  the token exchange and the callback. ~300 lines of your code, no new
  dependency, and it reuses the JWT/session/revocation machinery you already
  have.
- **Option B: hand-rolled routes.** You write `/api/auth/oauth/[provider]` and
  `/callback` yourself, mint the session cookie yourself. ~600 lines, and you
  re-implement state, PKCE, error handling and cookie signing — all of which
  are security-critical and already written correctly next to you.

The rest of this plan is written so that **the adapter layer is identical in
both cases** (`lib/auth/oauth/<provider>.ts`). Only §5 changes. Build the
adapters first; that is where the real work and all three of the sharp edges
are.

---

## 1. Prerequisites that are not code

Nothing below works until these exist.

### 1.1 Google

1. Google Cloud Console → new project `zaino-auth` → **APIs & Services →
   OAuth consent screen**.
2. User type **External**. Scopes: `openid`, `email`, `profile` only. Adding
   anything else triggers Google verification (weeks).
3. **Publish** the consent screen. While it is in "Testing", only emails you
   list can sign in — that is the #1 cause of "it works for me, not for users".
4. **Credentials → Create OAuth client ID → Web application.**
   Authorised redirect URIs (exact, no trailing slash):
   ```
   https://zaino.soon.it/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   ```

### 1.2 GitHub

1. **Settings → Developer settings → OAuth Apps → New OAuth App.**
2. Callback URL: `https://zaino.soon.it/api/auth/callback/github`
   (one URL per app — create a second OAuth App for localhost).
3. Scope: `read:user user:email` — **`user:email` is required** to read a
   private primary address. Without it you get `null` email and cannot link.

### 1.3 Apple — the one that costs money and cannot be avoided

Apple sign-in requires an Apple Developer Program membership (**$99/year**), and
has three credentials, not one:

| Credential | Where | What it is |
|---|---|---|
| Team ID | Membership page | 10 chars |
| Services ID | Identifiers → Services IDs | the OAuth `client_id`, e.g. `ai.zaino.desktop.web` |
| Key (`.p8`) | Keys → new key, "Sign in with Apple" | downloaded **once**, cannot be re-downloaded |
| Key ID | next to the key | 10 chars |

The flow differs from Google/GitHub in four ways that break naive adapters:

1. **The client secret is a JWT you generate**, not a string Apple gives you.
   ES256-signed with the `.p8`, claims `iss`=TeamID, `sub`=ServicesID,
   `aud`=`https://appleid.apple.com`, `exp` ≤ 6 months. It must be re-minted
   before expiry — a static env var will silently expire in 6 months.
2. **The user's email arrives in a POST body**, not a query string. Apple sends
   `application/x-www-form-urlencoded` to the redirect URI, with `code`,
   `id_token` and, on first consent only, a `user` JSON blob containing the
   name. **The name is never sent again** — if you do not persist it at first
   sign-in, it is gone.
3. **Private relay addresses.** Users can choose to hide their email; you get
   `xyz@privaterelay.appleid.com`. It works for delivery only if you register
   the domain in Apple's console.
4. **No `.com` email implies unverified.** Apple sets `email_verified: "true"`
   as a *string*. Google sends a *boolean*. Both must be normalised.

If Apple is not needed at launch, ship Google + GitHub and add Apple when the
company account exists — the adapter interface below makes that an additive
change.

### 1.4 Environment variables

```bash
# Google
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...

# GitHub
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# Apple (three of the four are not secrets but belong together)
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_SERVICES_ID=ai.zaino.desktop.web
APPLE_KEY_ID=YYYYYYYYYY
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Apple's `.p8` contains newlines; either store it base64-encoded and decode at
runtime, or store it with literal `\n` and replace them. A PEM pasted into a
`.env` unquoted is the most common deploy failure in this whole plan.

---

## 2. Data model

### 2.1 What already exists — reuse, do not recreate

| Table | Column | Status |
|---|---|---|
| `auth_users` | `id`, `email`, `email_verified`, `name` | ✅ the identity |
| `auth_accounts` | `provider`, `provider_account_id`, `user_id`, + token columns | ✅ **exactly the OAuth account shape.** `primaryKey(provider, providerAccountId)` is already correct |
| `users` | `auth_provider`, `auth_id`, `email`, `email_verified_at` | ✅ the domain mirror all product logic reads |
| `auth_verification_tokens` | `identifier`, `token` (hashed), `expires` | ✅ reuse for email verification |

`auth_accounts` has been sitting unused since the Clerk migration. It is the
table this feature was designed for.

### 2.2 What to add — one migration, `0041_oauth_identity.sql`

```sql
-- 1. One row per (provider, provider_account_id) is already the primary key.
--    Add the uniqueness the linking policy needs: an email may only be
--    auto-linked when EXACTLY ONE identity owns it, so a lookup by email must
--    be cheap and a duplicate must be impossible.
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_lower_idx
  ON auth_users (lower(email));

-- 2. Provider metadata that is not a token: the display handle and the
--    avatar URL as the provider gave it. Never used for authorization.
ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS provider_email      text,
  ADD COLUMN IF NOT EXISTS provider_email_verified boolean,
  ADD COLUMN IF NOT EXISTS provider_login      text;

-- 3. Apple's private-relay addresses must never be treated as a corporate
--    domain, and must be flagged so support can explain delivery.
ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS email_is_private_relay boolean NOT NULL DEFAULT false;

-- 4. Audit: which method created the account. Support cannot answer
--    "how did this person sign up" today.
ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS signup_method text NOT NULL DEFAULT 'password';
```

Guard in the same file: `signup_method` must be one of
`password | google | github | apple`, else raise.

### 2.3 The identity resolution rule — the heart of the whole plan

Getting this wrong is how an OAuth implementation hands one person another
person's account. The rule, in order:

```
1. Does (provider, provider_account_id) already exist in auth_accounts?
     → YES: sign in that user_id. Done. This is the ONLY path that signs in.

2. No account row. Is there an auth_users row with the same email
   AND email_verified IS NOT NULL  AND the provider says the email is verified?
     → YES: link — insert auth_accounts(provider, provider_account_id, existing user_id).
              Never create a second user.
     → NO : create a new auth_user + domain mirror, signup_method = provider.

3. Provider says the email is NOT verified
     → NEVER auto-link to an existing account.
       Create a separate identity and require our own email verification
       before that account can mint keys or check out.
```

Why each clause:

- **(1) before (2)** — an account row is proof the provider vouched for that
  identity *to us*. Email matching is a heuristic; the account row is a fact.
- **verified-only linking** — otherwise: attacker registers at GitHub with
  `victim@company.com` (GitHub does not verify emails it does not own) and gets
  into the victim's Zaino account.
- **(3) never link** — an unverified provider email is exactly that attack.
- **`email_is_private_relay`** — a relay address is per-app and per-user; two
  different people can never share one, so it is safe to treat as unique, but
  it must never be joined against a corporate domain list.

---

## 3. The adapter layer — `lib/auth/oauth/`

One file per provider, one shared interface. This is the only provider-specific
code in the plan, and it is identical under Option A and Option B.

```ts
// lib/auth/oauth/types.ts
export interface OAuthProvider {
  id: 'google' | 'github' | 'apple';
  name: string;

  /** Authorization endpoint + the exact params we send. */
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;      // PKCE S256
    nonce?: string;             // Apple + Google
  }): string;

  /** Token endpoint: code + verifier -> tokens. */
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;       // Apple: a JWT we mint (see apple.ts)
  }): Promise<{
    accessToken: string;
    idToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string;
    tokenType?: string;
  }>;

  /** Normalise THIS provider's response into one identity shape. */
  fetchIdentity(input: {
    accessToken: string;
    idToken?: string;           // Apple: identity is only in here; verify the sig
  }): Promise<{
    providerAccountId: string;
    email: string | null;
    emailVerified: boolean;     // normalised — see §3.1
    name: string | null;
    image: string | null;
    login: string | null;       // GitHub handle; null elsewhere
  }>;
}
```

### 3.1 The three response shapes, and what each gets wrong

**Google — one call, everything present.**
`GET https://openidconnect.googleapis.com/v1/userinfo` with the bearer.
Returns `sub`, `email`, `email_verified` (**boolean**), `name`, `picture`.
Prefer `id_token` + JWKS verification when you can: `userinfo` trusts the
bearer, `id_token` proves the token came from Google for *your* client.

**GitHub — two calls, because email is often private.**
`GET https://api.github.com/user` → `id`, `login`, `name`, `avatar_url`,
`email` (**null when private**). Then `GET https://api.github.com/user/emails`
with the `user:email` scope → array of
`{ email, primary, verified, visibility }`. Rule: take the `primary && verified`
entry; if none, the identity is **unverified** (§2.3 clause 3).
`providerAccountId` is the numeric `id`, not `login` — logins are renameable.

**Apple — no userinfo endpoint at all.**
Identity comes from the `id_token` returned by the token exchange, and **the
signature must be verified** against Apple's JWKS
(`https://appleid.apple.com/auth/keys`), checking `aud` = your Services ID and
`iss` = `https://appleid.apple.com`. Claims: `sub`, `email`,
`email_verified` (**string `"true"`**), `is_private_email` (**string**).
The name arrives once, in the POST body's `user` field at first consent — parse
and persist it there or lose it.

**The normalisation table — write this once, test it:**

| Provider | email | email_verified | name | account id |
|---|---|---|---|---|
| Google | string | boolean | string | `sub` |
| GitHub | from `/user/emails` | from `verified` | `name \|\| login` | numeric `id` |
| Apple | id_token claim | **string** `"true"` | POST body, once | `sub` |

---

## 4. The flow — every step, every failure

```
 GET /sign-in
   └─ click "Continue with Google"
        │
        ├─ 1. generate state       = 32 random bytes, base64url
        ├─ 2. generate codeVerifier= 32 random bytes, base64url
        ├─ 3. codeChallenge        = base64url(sha256(codeVerifier))
        ├─ 4. set cookie `oauth_pending` = { state, verifier, provider, returnTo }
        │      httpOnly, Secure, SameSite=Lax, 10-minute maxAge, path=/
        │      ← SameSite=Lax (not Strict): the callback is a cross-site GET,
        │        and Strict drops the cookie, producing an infinite login loop.
        ├─ 5. 302 to authorizationUrl(...)
        │
 GET /api/auth/callback/google?code=…&state=…
        │
        ├─ 6. read `oauth_pending`; missing → 400 "start again" (not a 500)
        ├─ 7. constant-time compare state; mismatch → 400, DELETE cookie
        ├─ 8. verify provider is the one we started (cookie, not query)
        ├─ 9. exchange code → tokens
        ├─10. fetchIdentity → normalised identity
        ├─11. resolve (§2.3) → auth user id
        ├─12. upsert auth_accounts (provider, providerAccountId, tokens)
        ├─13. mirror to `users`; stamp email_verified_at per §2.3
        ├─14. mint session  (Option A: signIn('provider', …); Option B: your own)
        ├─15. DELETE `oauth_pending`
        └─16. 302 to returnTo (validated same-site — reuse safeReturnPath)
```

**Failure modes that must each have a distinct, non-leaking message:**

| Case | Answer | Why |
|---|---|---|
| `state` mismatch | 400 "sign-in link expired, start again" | CSRF. Delete the cookie. |
| `error=access_denied` (user cancelled) | redirect to `/sign-in` with a quiet notice | NOT an error page. Cancelling is normal. |
| Provider says email unverified | account created, `email_verified_at` NULL, banner to verify | never auto-link |
| Token exchange 4xx | log provider + status, show generic failure | the body can contain the code |
| Network timeout | 15s per call, then fail fast | a hanging callback holds a slot |
| Provider returns no email at all | create identity with a `.invalid` placeholder, prompt for one | Apple relay users can do this |
| Verified address already held by an UNCONFIRMED account here | refuse with `/sign-in?social=email_taken`: confirm that account or reset it | a second identity on the same address is impossible (0041's unique index); linking would hand a password-protected account to whoever reads the inbox |

**Never log:** `code`, `access_token`, `id_token`, `refresh_token`, the `.p8`,
`codeVerifier`. Log `provider`, `status`, `providerAccountId` only.

---

## 5. Wiring into `auth.ts` (Option A) — the recommended change

Add one `OAuthConfig` per provider to the existing `providers` array. The
Credentials provider and everything below it in the file — `jwt`, `session`,
`events`, `logger` — is untouched, because it keys off `user.id` and the
password stamp, both of which the OAuth path supplies.

```ts
{
  id: 'google',
  name: 'Google',
  type: 'oauth',
  authorization: { url: 'https://accounts.google.com/o/oauth2/v2/auth',
                   params: { scope: 'openid email profile', prompt: 'select_account' } },
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  checks: ['state', 'pkce'],
  profile(p) {
    return {
      id: String(p.sub),
      email: typeof p.email === 'string' ? p.email : null,
      name: typeof p.name === 'string' ? p.name : null,
      image: typeof p.picture === 'string' ? p.picture : null,
      // NOT carrying emailVerified on `User` — see §6.2.
    };
  },
}
```

Three rules for this block, each learned from a real failure mode:

1. **`checks: ['state', 'pkce']`** — omitting pkce works today and is the single
   most commonly skipped control in OAuth integrations.
2. **`profile()` must be total** — every field nullable, never throwing on a
   missing claim. One provider returning `email: null` must not 500 sign-in.
3. **`allowDangerousEmailAccountLinking` stays OFF.** It is the flag that makes
   §2.3's verification rule optional, and it is how accounts get taken over.

`session`/`jwt` callbacks need **no change**: the OAuth `user.id` is the
`auth_users.id`, exactly like the credentials path.

---

## 6. Email verification — the part that must stay yours

### 6.1 What you already have, and why not to replace it

`lib/auth/verify-email.ts` already does: hashed token, 30-minute TTL, one active
token per account, `requireVerifiedEmail()` gating keys + checkout. Reuse it
verbatim. Do **not** let a provider's "verified" claim replace your own gate for
sensitive actions — you cannot audit their process.

### 6.2 The stamping rule

| Situation | `users.email_verified_at` |
|---|---|
| Provider says verified **and** it is the account's canonical email | stamp now |
| Provider says unverified (GitHub private primary, Apple unverified) | leave NULL, send our email |
| Email is an Apple private relay | stamp (Apple verified the mailbox) but set `email_is_private_relay = true` |
| Existing account links a NEW provider whose email differs | do **not** change `users.email`; record `provider_email` on the account row |

That last row matters: an existing `alice@company.com` who later signs in with a
personal Google account must not have their account email rewritten by it.

### 6.3 The one gap this plan should close while you are here

`requireVerifiedEmail` currently gates **keys** and **checkout** but not
**chat** or **trial redemption** (`app/api/trial/redeem/route.ts:44`,
`app/api/chat/route.ts:200`). With social login that becomes sharper: a user can
now arrive with an unverified provider email, redeem a trial, and spend real
upstream tokens without ever proving they can receive mail. Add the gate to
both, with the same 403 copy.

---

## 7. UI

`components/auth/sign-in-form.tsx` and `sign-up`: a button row above the
existing form, one per enabled provider, each a plain `<a href="/api/auth/signin/<id>">`
(or a server-action POST under Option A). Rules:

- **Only render a provider whose env vars are set.** A button that 500s on click
  is worse than no button.
- **Do not use provider logos** unless you are within their brand guidelines —
  Google and Apple both require a specific button asset. "Continue with Google"
  as text is always safe; a hand-drawn logo is not.
- **One divider**: "or continue with email".
- The consent screen name must be `Zaino AI` in both consoles — users see it.

---

## 8. Tests — the ones that matter

Unit (pure, no network):

1. `resolveIdentity()` against a table of cases: existing account; verified
   email linking; **unverified email NOT linking**; private relay; provider
   email differing from account email (§6.2 row 4).
2. Each adapter's `fetchIdentity` against recorded fixture payloads — including
   GitHub with `email: null`, and Apple with `email_verified: "true"` as a
   string and `is_private_email: "true"`.
3. State comparison is constant-time and rejects a mismatch.
4. Apple secret JWT: correct `iss`/`sub`/`aud`, `exp` ≤ 6 months, ES256.

Integration (local callback server, no real provider):

5. A callback with a missing `oauth_pending` cookie answers 400, not 500.
6. `?error=access_denied` redirects to `/sign-in` without an error page.
7. The `oauth_pending` cookie is deleted on success AND on failure.
8. After a successful sign-in, `auth_accounts` has one row and `users` is
   mirrored — re-running the callback twice does not create two users.

Manual, once, per provider (cannot be automated):

9. First-ever consent stores the Apple name (§1.3 — it never comes again).
10. Google consent screen is **published**, not in Testing.
11. Production callback URLs match exactly, including the absence of a trailing
    slash.

---

## 9. Sequencing

| Step | Work | Done when |
|---|---|---|
| 1 | `0041_oauth_identity.sql` + schema | migration applies, guards pass |
| 2 | `lib/auth/oauth/types.ts` + `google.ts` | unit tests 1–2 pass for Google |
| 3 | Google wired in `auth.ts` | you sign in with a real Google account on localhost |
| 4 | `resolveIdentity()` + linking tests | unit test 1 passes, all six cases |
| 5 | `github.ts` (two-call email) | GitHub sign-in works with a **private** email |
| 6 | Sign-in / sign-up UI | provider buttons hidden when unconfigured |
| 7 | `apple.ts` + Apple secret minting | Apple sign-in works; name persisted |
| 8 | §6.3 verification gates on chat + trial | a fresh social account cannot spend unverified |
| 9 | Docs: "sign in with Google/GitHub/Apple" | `/docs` and `/faq` mention it |

Steps 2–4 are the real work. Steps 6–9 are assembly.

---

## 10. Explicitly out of scope

- **Refresh tokens / offline access.** Not needed to sign in; storing them
  creates a long-lived credential you must protect. Revisit only if you call
  Google APIs on the user's behalf.
- **Provider logos.** See §7.
- **Account unlinking / a connected-accounts UI.** Will be wanted; not a launch
  feature.
- **Org SSO (SAML/OIDC against a customer's IdP).** Different problem, and the
  reason Zitadel/Keycloak exist. Social login does not get you there.
- **Replacing your credentials provider.** Both must work side by side; a
  customer with a password must never be forced to adopt a social login.

---

## 11. The security rules, collected

1. `state` on every request, compared constant-time, cookie-scoped.
2. PKCE S256 always, even for confidential clients.
3. `oauth_pending` cookie: httpOnly, Secure, **SameSite=Lax**, 10 min, deleted
   on both success and failure.
4. Link accounts only on a provider-**verified** email, and only when no other
   identity already owns that address.
5. `allowDangerousEmailAccountLinking` never enabled.
6. Verify Apple's `id_token` signature before trusting a single claim.
7. `providerAccountId` for GitHub is the numeric id, never `login`.
8. Never log codes, tokens, the `.p8` or the verifier.
9. Your own email verification still gates keys, checkout, chat and trials.
10. Apple's client secret is re-minted before its 6-month expiry — a static
    value will break silently.
