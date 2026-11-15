/**
 * The one definition of our callback URL.
 *
 * WHY IT MUST BE SHARED. The `redirect_uri` sent on the authorization
 * request and the one sent on the token exchange must be BYTE-IDENTICAL —
 * providers compare them, and a mismatch is rejected with an opaque error
 * after the user has already consented. `start` and `callback` build it from
 * different requests, so if either derives it from its own request origin
 * they disagree the moment the deployment sits behind a proxy (Caddy, here)
 * or the two requests arrive on different hosts.
 *
 * AUTH_URL is the canonical origin, already used by lib/auth/actions.ts for
 * exactly this reason. Falling back to the request origin keeps localhost
 * working with no configuration.
 */
export function canonicalOrigin(requestUrl: string): string {
  const configured = (process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (configured) return configured;
  return new URL(requestUrl).origin;
}

export function callbackUrlFor(requestUrl: string, provider: string): string {
  return `${canonicalOrigin(requestUrl)}/api/oauth/${provider}/callback`;
}
