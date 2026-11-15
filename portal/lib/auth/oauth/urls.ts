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
/**
 * The first configured value that is actually usable.
 *
 * `??` is WRONG here and was a real bug: `AUTH_URL=` (present but empty, the
 * shape a commented-out .env line leaves behind) is nullish only in the
 * `undefined` sense — `'' ?? x` yields `''`, so an empty AUTH_URL would
 * shadow a valid NEXT_PUBLIC_APP_URL and drop the origin to the container's
 * bind address. Empty and whitespace-only must count as absent.
 */
function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function canonicalOrigin(requestUrl: string): string {
  const configured = firstNonEmpty(process.env.AUTH_URL, process.env.NEXT_PUBLIC_APP_URL);
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(requestUrl).origin;
}

export function callbackUrlFor(requestUrl: string, provider: string): string {
  return `${canonicalOrigin(requestUrl)}/api/oauth/${provider}/callback`;
}
