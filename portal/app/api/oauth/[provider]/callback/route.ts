/**
 * GET|POST /api/oauth/<provider>/callback — finish a social sign-in.
 *
 * POST is not optional. Apple sends `response_mode=form_post`, so its
 * callback arrives as application/x-www-form-urlencoded in a BODY. A route
 * that only exports GET answers Apple with 405 and every Apple sign-in dies
 * at the last step.
 *
 * EVERY branch below has one job: never sign in on a claim we did not
 * verify. In order —
 *
 *   1. cancel (error=access_denied)  → /sign-in, quiet notice, no error page
 *   2. no pending cookie             → 400 "start again" (NOT 500)
 *   3. provider mismatch             → 400, cookie deleted
 *   4. state mismatch (constant time)→ 400, cookie deleted
 *   5. exchange / identity failure   → /sign-in?social=failed, generic
 *   6. resolve (§2.3)                → account, then mint the session
 *
 * The cookie is deleted on EVERY terminal path, including success: a
 * callback URL replayed from browser history then finds no pending flow
 * instead of trying to redeem a spent code.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { clientSecretFor, providerConfig, type ProviderId } from '@/lib/auth/oauth';
import { readPendingCookie, clearPendingCookie, safeEqual } from '@/lib/auth/oauth/state';
import { evaluateCallback, rejectDestination } from '@/lib/auth/oauth/callback-policy';
import { resolveIdentity } from '@/lib/auth/oauth/resolve';
import { mintSession, passwordChangedAtFor } from '@/lib/auth/oauth/session';
import { OAuthProviderError } from '@/lib/auth/oauth/types';
import { callbackUrlFor, canonicalOrigin } from '@/lib/auth/oauth/urls';
import { log } from '@/lib/log';
import { safeReturnPath } from '@/lib/billing/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where a first-time social signup lands. /chat is the product (see app/sign-in/page.tsx). */
const DEFAULT_LANDING = '/chat';

/**
 * Redirect on the CANONICAL origin.
 *
 * NOT `new URL(path, request.url)`: behind Caddy that origin is the
 * container's bind address (`0.0.0.0:3000`), which a browser cannot reach.
 * Verified live against production, not theorised.
 */
function redirect(request: NextRequest, path: string, params?: Record<string, string>): NextResponse {
  const url = new URL(path, canonicalOrigin(request.url));
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** Failure copy is fixed and never echoes provider text: it can carry the code. */
function fail(request: NextRequest, reason: string, status = 400): NextResponse {
  return redirect(request, '/sign-in', { social: reason });
}

interface CallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  /** Apple only: the first-consent name blob, JSON, in the POST body. */
  user: string | null;
}

/**
 * Read the callback payload from query OR body.
 *
 * Apple posts a form body; Google and GitHub use the query string. Both are
 * read for every provider — reading both is cheaper than branching, and a
 * provider that switches shape (Apple has) then keeps working.
 */
async function readCallbackParams(request: NextRequest): Promise<CallbackParams> {
  const q = request.nextUrl.searchParams;
  let body: URLSearchParams | null = null;

  if (request.method === 'POST') {
    try {
      const form = await request.formData();
      body = new URLSearchParams();
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') body.set(k, v);
      }
    } catch {
      body = null;
    }
  }

  const pick = (name: string): string | null => body?.get(name) ?? q.get(name);
  return {
    code: pick('code'),
    state: pick('state'),
    error: pick('error'),
    user: pick('user'),
  };
}

/** Apple's `user` blob → the two fields the adapter uses. Never trusted beyond display. */
function parseAppleName(raw: string | null): { firstName?: string; lastName?: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } };
    const name = parsed?.name;
    if (!name || typeof name !== 'object') return null;
    return {
      firstName: typeof name.firstName === 'string' ? name.firstName : undefined,
      lastName: typeof name.lastName === 'string' ? name.lastName : undefined,
    };
  } catch {
    // A malformed name is not a reason to refuse sign-in; the profile is
    // simply nameless and the user can set one later.
    return null;
  }
}

function isProviderId(v: string): v is ProviderId {
  return v === 'google' || v === 'github' || v === 'apple';
}

async function handle(request: NextRequest, provider: string): Promise<NextResponse> {
  const params = await readCallbackParams(request);

  // Everything the gate sequence needs, read BEFORE any branch runs — see
  // lib/auth/oauth/callback-policy.ts for why the ORDER is the property
  // being protected here.
  const pending = await readPendingCookie();
  const verdict = evaluateCallback({
    providerParam: provider,
    providerKnown: isProviderId(provider),
    providerError: params.error,
    hasPending: pending !== null,
    pendingProvider: pending?.provider ?? null,
    state: params.state,
    pendingState: pending?.state ?? null,
    hasCode: params.code !== null,
  });

  if (verdict.gate === 'reject') {
    // Every rejection clears the cookie: a callback URL replayed from
    // history must find no pending flow rather than redeeming a spent code.
    await clearPendingCookie();
    const dest = rejectDestination(verdict.reason);
    if (verdict.reason === 'cancelled') {
      // Cancelling is normal — informational, not a warning.
      log.info('oauth callback: cancelled at provider', { provider });
    } else {
      log.warn('oauth callback: rejected before exchange', { provider, reason: verdict.reason });
    }
    return redirect(request, dest.path, dest.query);
  }

  // Constant-time state comparison, now that the pure gate has established
  // both values exist and the flow belongs to this provider.
  if (!pending || !params.state || !safeEqual(params.state, pending.state)) {
    await clearPendingCookie();
    return fail(request, 'expired');
  }

  if (!params.code) {
    await clearPendingCookie();
    return fail(request, 'failed');
  }

  if (!isProviderId(provider)) {
    // Unreachable: evaluateCallback rejected it. Kept as a type narrowing
    // for the calls below.
    await clearPendingCookie();
    return fail(request, 'unknown_provider');
  }

  const config = providerConfig(provider);
  if (!config) {
    await clearPendingCookie();
    log.error('oauth callback: provider lost its configuration', { provider });
    return fail(request, 'unavailable');
  }

  // ── 5. Exchange + identity. Any failure here is generic to the user
  //       and specific in the log (provider + status only). ───────────
  let identity;
  let tokens;
  try {
    const clientSecret = await clientSecretFor(provider, config);
    tokens = await config.adapter.exchangeCode({
      code: params.code,
      // Identical to the value sent on the authorization request, by
      // construction — see lib/auth/oauth/urls.ts.
      redirectUri: callbackUrlFor(request.url, provider),
      codeVerifier: pending.codeVerifier,
      clientId: config.clientId,
      clientSecret,
    });

    identity = await config.adapter.fetchIdentity({
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      clientId: config.clientId,
      nonce: pending.nonce ?? undefined,
      initialName: params.user ? parseAppleName(params.user) : null,
    });
  } catch (e) {
    await clearPendingCookie();
    if (e instanceof OAuthProviderError) {
      // status + reason only. The body and the code never reach a log line.
      log.error('oauth callback: provider rejected the exchange', {
        provider: e.provider,
        status: e.status,
        reason: e.reason,
      });
    } else {
      log.error('oauth callback: exchange threw', {
        provider,
        name: e instanceof Error ? e.name : 'unknown',
      });
    }
    return fail(request, 'failed');
  }

  // ── 6. Resolve, then mint the session. ────────────────────────────
  try {
    const outcome = await resolveIdentity({ provider, identity, tokens });

    const stamp = await passwordChangedAtFor(outcome.userId);
    await mintSession({
      authUserId: outcome.userId,
      email: identity.email ?? '',
      passwordChangedAt: stamp,
    });

    await clearPendingCookie();

    log.info('oauth sign-in', {
      provider,
      providerAccountId: identity.providerAccountId,
      outcome: outcome.kind,
    });

    // An unverified identity still gets a session: they need a dashboard to
    // resend the verification mail. What they cannot do is spend — the
    // gates in §6.3 refuse keys, checkout, chat and trials until verified.
    if (outcome.kind === 'created_unverified') {
      return redirect(request, DEFAULT_LANDING, { verify: 'required' });
    }

    return redirect(request, safeReturnPath(pending.returnTo) || DEFAULT_LANDING);
  } catch (e) {
    await clearPendingCookie();
    log.error('oauth callback: resolve failed', {
      provider,
      name: e instanceof Error ? e.name : 'unknown',
    });
    return fail(request, 'failed');
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  return handle(request, provider);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  return handle(request, provider);
}
