/**
 * GET /api/oauth/<provider>/start — begin a social sign-in.
 *
 * WHY THIS IS NOT UNDER /api/auth/. Auth.js mounts a CATCH-ALL at
 * /api/auth/[...nextauth], which claims every path beneath it. A sibling
 * static segment would depend on router precedence to win, and that is not
 * a property to bet an auth path on. A separate namespace is unambiguous.
 *
 * The route only redirects. Everything it needs is generated here and
 * stored in an httpOnly cookie; nothing is signed into the URL except
 * `state`, which is useless without the cookie (§4).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { clientSecretFor, providerConfig } from '@/lib/auth/oauth';
import { codeChallengeFor, createPendingFlow, setPendingCookie } from '@/lib/auth/oauth/state';
import { callbackUrlFor, canonicalOrigin } from '@/lib/auth/oauth/urls';
import { log } from '@/lib/log';
import { safeReturnPath } from '@/lib/billing/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Redirect to /sign-in on the CANONICAL origin.
 *
 * NOT `new URL(path, request.url)`. Behind Caddy the portal is reached over
 * the docker bridge, so `request.url` carries the container's own bind
 * address — in production this produced
 * `https://0.0.0.0:3000/sign-in?social=unavailable`, a URL no browser can
 * follow. Observed live, not hypothesised. `canonicalOrigin` prefers
 * AUTH_URL, which docker-compose sets from PORTAL_DOMAIN.
 */
function signInRedirect(request: NextRequest, reason: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/sign-in?social=${encodeURIComponent(reason)}`, canonicalOrigin(request.url)),
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;

  // Unknown provider is a 404, not a 500 or a redirect to a provider that
  // would then reject us.
  const config = provider === 'google' || provider === 'github' || provider === 'apple'
    ? providerConfig(provider)
    : null;

  if (!config) {
    log.warn('oauth start: provider not configured', { provider });
    return signInRedirect(request, 'unavailable');
  }

  const returnTo = safeReturnPath(request.nextUrl.searchParams.get('returnTo'));

  const flow = createPendingFlow(provider as 'google' | 'github' | 'apple', returnTo);

  // Apple's secret is minted per exchange, so it is irrelevant here; the
  // call exists to prove the configuration is usable BEFORE the user is
  // sent to a consent screen we cannot complete. Cheap and fail-fast.
  if (provider === 'apple') {
    try {
      await clientSecretFor('apple', config);
    } catch {
      log.error('oauth start: apple secret could not be minted', { provider });
      return signInRedirect(request, 'unavailable');
    }
  }

  const url = config.adapter.authorizationUrl({
    clientId: config.clientId,
    redirectUri: callbackUrlFor(request.url, provider),
    state: flow.state,
    codeChallenge: codeChallengeFor(flow.codeVerifier),
    nonce: flow.nonce ?? undefined,
  });

  await setPendingCookie(flow);
  return NextResponse.redirect(url);
}
