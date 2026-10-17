# Zaino Desktop sign-in — device-code flow

Fresh installs sign in without pasting a key. The desktop app opens the
portal in the system browser, the person approves the device in an Auth.js
session, and the app collects a device-scoped gateway key (`zn-…`) by
polling. Inference never leaves the loopback proxy — only the two
device-code HTTP calls and the one-time key collection touch the portal,
and the key itself is handled entirely in the desktop's Rust backend.

## The flow

```
Desktop app                     Portal (Next.js)                    Person
    │                                    │                              │
    │  POST /api/auth/device             │                              │
    │  (anonymous)                       │                              │
    ├───────────────────────────────────▶│                              │
    │◀ device_code                       │                              │
    │  user_code                         │                              │
    │  verification_url                  │                              │
    │  expires_in (900s)                 │                              │
    │                                    │                              │
    │  open verification_url             │                              │
    │──── browser ──────────────────────▶│                              │
    │                                    │  sign in (Auth.js credentials)│
    │                                    │◀─────────────────────────────│
    │                                    │  approve user_code (POST      │
    │                                    │  /api/auth/device/verify)    │
    │                                    │◀─────────────────────────────│
    │                                    │  mint device key zn-…        │
    │  POST /api/auth/device/token       │  (one-time plaintext held    │
    │  (every `interval` seconds)        │   in device_codes, nulled    │
    │◀──────────────────────────────────▶│   on collection)             │
    │  { token, models,                  │                              │
    │    user, organization }            │                              │
    ▼
 keychain write → catalog refresh →
 Claude channel wiring (loopback only)
```

## Endpoints

### `POST /api/auth/device`

Issues a device-code authorization. Anonymous — the code is useless until
an Auth.js session approves it.

Response `200`:

```json
{
  "device_code": "<43-char base64url, returned once>",
  "user_code": "ABCD1234",
  "verification_url": "https://portal/device?user_code=ABCD1234",
  "expires_in": 900,
  "interval": 5
}
```

Only the SHA-256 of `device_code` is stored. Codes expire 15 minutes after
issue, approved or not.

### `POST /api/auth/device/verify`

Approves a `user_code`. Requires ALL of: an Auth.js session (email,
freshness-checked); membership in an organization with an active plan
(`payment_required` otherwise); a role that can mint keys (developer and
above); a pending, unexpired code; a same-origin request (`Origin`/`Referer`
must match `APP_URL`).

On approval the portal **rotates** the organization's device key: every
previous `kind='device'` key is revoked upstream and locally, one fresh key
is minted (plan models, 30-day `expires`/`duration`) and registered in
`api_keys` with `kind='device'`. Returns `{ approved: true }` — **no
secret**. The one-time plaintext waits in `device_codes.key_plaintext` for
the app's poll.

### `POST /api/auth/device/token`

Polled by the desktop app with `{ device_code }`. No session — the code
itself is the credential. Responses:

| State | Status | Body |
|---|---|---|
| Approved | `200` | `{ token, models, user: {id,email,name}, organization: {id,slug,name} }` |
| Pending | `400` | `{ error: { code: 'authorization_pending', message } }` |
| Polled too fast | `400` | `{ error: { code: 'slow_down', message } }` |
| Expired | `400` | `{ error: { code: 'expired_token', message } }` |
| Already collected | `400` | `{ error: { code: 'invalid_grant', message } }` |
| Revoked | `400` | `{ error: { code: 'access_denied', message } }` |

The `200` is delivered **exactly once**: the row flips to `consumed` and
`key_plaintext` is nulled before responding, so a replayed poll can never
collect the key again.

### `GET /device`

Portal approval page. Reads `?user_code=`, redirects to
`/sign-in?callbackUrl=/device?user_code=…` when there is no session, and
otherwise shows the code state (pending form / approved / expired /
already-used / revoked). The approve button posts to
`/api/auth/device/verify`. No secret ever renders here.

## Desktop side (ccgui)

- Rust: `src-tauri/src/gateway/device.rs` — `gateway_device_begin`
  (issue + spawn the poll loop), `gateway_device_cancel`. The webview sees
  only display data (`user_code`, `verification_url`) and phase events on
  `gateway://device`; the `zn-…` token goes straight to the OS keychain +
  live state via the same validate-then-store path as the paste flow.
- React: `useDeviceFlow.ts` (state machine `idle → awaiting-browser →
  approved | expired | cancelled | error`, opens the browser, wires the
  Claude channel on approval), `LoginScreen.tsx` (primary "Sign in with
  Zaino" + "Paste device key" fallback), i18n under
  `gateway.login.deviceFlow`.

## Invariants

- No API secret in config, settings, renderer state, logs, or audit rows.
  The plaintext lives in exactly three places with bounded lifetimes: the
  `device_codes.key_plaintext` column (≤15 min, nulled on consume), proxy
  memory (runtime), and the OS keychain (at rest).
- One device key per organization: approval revokes previous device keys
  before minting.
- ~30-day key lifetime (`api_keys.expires_at` + gateway `duration`);
  restart-within-30-days needs no sign-in (existing keychain restore +
  background catalog refresh); a rejected key prompts sign-in again and the
  bad key is cleared.
- Plan changes flow through `planForOrg()`: the device key inherits the
  same budget, limits, and models as a dashboard-minted key.
- The portal is contacted only for the device endpoints. Model traffic
  stays on `127.0.0.1:18789` behind `zaino-v1`-marked provider files that
  contain no secret.

## Testing

- Portal: `tests/device.test.ts` — issuance TTL/alphabet, approval (mint,
  plaintext-once, 400/402/403/409 paths), rotation of the previous device
  key, polling (pending → grant → consume → replay-rejected, slow_down,
  expired, revoked), 30-day expiry.
- Desktop Rust: `gateway::device::tests` — portal-error mapping, token
  shape check, interval clamp, run supersession.
- Desktop TS: `LoginScreen.test.tsx` (entry, waiting, approval, expiry +
  retry, cancel + fallback, backend error mapping, paste fallback) and
  `useDeviceFlow.test.tsx` (event → state machine, channel wiring, no
  `zn-` in state).

Fake expired/pending/current states, double approval, revocation, and app
restart are all covered by the cases above; migration
`portal/db/migrations/0013_device_codes.sql` holds the `device_codes`
table and `api_keys.kind`.
