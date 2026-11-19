/**
 * Service-token auth for the D17 agent surface.
 *
 * WHY NOT THE ADMIN GATE. Every other admin route authenticates a BROWSER:
 * an `admin_gate` cookie proves someone knows a shared code, and a staff row
 * supplies the rank. Neither works for n8n — it has no cookie jar, and the
 * gate "names nobody", so it cannot carry the attribution a money-moving
 * action needs.
 *
 * WHY IT FAILS CLOSED, UNLIKE THE GATE. `gateCookieValid()` returns true
 * when `ADMIN_GATE_SECRET` is unset, which is right for a gate: no secret
 * means no gate installed, and the cookie only ever admits someone to a
 * login form. This token is different in kind — it IS the authority, not a
 * door to it. An unset `D17_AGENT_TOKEN` must mean "this surface does not
 * exist", because the alternative is an unauthenticated endpoint that
 * approves payments on any deployment that forgot one env var.
 *
 * WHY A SEPARATE TOKEN AND NOT A STAFF ROW. The agent is denied at exactly
 * the point a staff row would grant it too much: `approveD17Payment()` takes
 * an actor id and writes it to `payments_d17.verified_by`, so giving the
 * agent a synthetic `staff_users` row would put it in `listD17Queue()`'s
 * queue and in the operator roster. The service layer passes `AGENT_ACTOR_ID`
 * straight to `approveD17Payment()` and audit names the actor as `system`
 * with a readable id — attributable without being a person.
 */

import crypto from 'node:crypto';

export class ServiceAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function configuredToken(): string | null {
  const raw = (process.env.D17_AGENT_TOKEN ?? '').trim();
  // A short token is worse than none: it looks configured while being
  // guessable. 32 chars is 128 bits of hex-or-base64 entropy as a floor.
  if (raw.length < 32) return null;
  return raw;
}

/** Constant-time compare that does not leak length through an early return. */
function tokensMatch(a: string, b: string): boolean {
  // Hash both to a fixed 32 bytes; `timingSafeEqual` throws on unequal
  // lengths, and the throw itself is an oracle for the token's length.
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function bearerFrom(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (header) {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = m?.[1]?.trim();
    if (token) return token;
  }
  // n8n's HTTP Request node makes a custom header easier than an auth
  // credential, so both are accepted. Same token, same check.
  const custom = req.headers.get('x-zaino-agent-token');
  return custom ? custom.trim() : null;
}

/**
 * Assert the caller is the D17 agent. Throws `ServiceAuthError` otherwise.
 *
 * 503 when unconfigured, 401 when wrong — the distinction matters to an
 * operator staring at an n8n workflow: one is "deploy step forgotten", the
 * other is "the token in the credential store is stale".
 */
export function requireAgentToken(req: Request): void {
  const expected = configuredToken();
  if (!expected) {
    throw new ServiceAuthError(503, 'D17 agent token is not configured on this deployment');
  }
  const presented = bearerFrom(req);
  if (!presented || !tokensMatch(presented, expected)) {
    throw new ServiceAuthError(401, 'Invalid agent token');
  }
}

/** Uniform error body so both routes answer the same way on auth failure. */
export function serviceAuthResponse(err: ServiceAuthError): Response {
  return Response.json(
    { error: err.message },
    {
      status: err.status,
      headers: {
        'WWW-Authenticate': 'Bearer',
        'Cache-Control': 'no-store',
      },
    },
  );
}
