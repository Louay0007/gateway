/**
 * The provider adapter contract — the only provider-specific code in the
 * OAuth implementation.
 *
 * WHY THIS EXISTS. Providers disagree about almost everything: how many
 * requests it takes to learn the email, whether `email_verified` is a
 * boolean or the string "true", whether the identity is in a JSON body or
 * inside a signed JWT. Everything ABOVE this interface (state, PKCE, the
 * linking rule, session minting) must never branch on provider, or the
 * linking rule has one implementation per provider and one of them will be
 * wrong.
 *
 * Nothing here performs a redirect or touches a cookie. Adapters are pure
 * request/response mapping so they can be tested against recorded fixtures
 * with no network (portal/tests/oauth-adapters.test.ts).
 */

/**
 * Apple was removed: it needs a paid Developer Program membership, a `.p8`
 * key and a per-request minted client secret, and the domain-association
 * file made it production-only. Adding it back means a new adapter, a
 * `providerConfig` branch, and its entry in `ORDER`.
 */
export type ProviderId = 'google' | 'github';

/** Human label. Used in UI copy and logs — never in comparison. */
export interface ProviderMeta {
  id: ProviderId;
  name: string;
  /** Where the user is sent to consent. */
  authorizationEndpoint: string;
  /** Scopes, exactly as the provider documents them. */
  scope: string;
}

/**
 * One identity, normalised. This is the ONLY shape the linking rule sees.
 *
 * `emailVerified` is a boolean here even though providers express it
 * differently — GitHub sends nothing at all — so `resolveIdentity` cannot
 * get it wrong per-provider.
 */
export interface OAuthIdentity {
  /** The provider's immutable id: Google `sub`, GitHub numeric `id`. */
  providerAccountId: string;
  /** NULL when the provider will not disclose one (GitHub without user:email). */
  email: string | null;
  /** False when the provider has not proven the address, or said nothing. */
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  /** Provider handle (GitHub login). NULL elsewhere. Never an identifier. */
  login: string | null;
  /**
   * ALWAYS FALSE since Apple was removed — it was the only provider issuing
   * `@privaterelay.appleid.com` addresses. The field stays because
   * `resolve.ts` writes it to `auth_users.email_is_private_relay`, and rows
   * created while Apple was enabled still carry that flag.
   */
  isPrivateRelay: boolean;
}

export interface OAuthTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
}

export interface AuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  /** base64url(SHA-256(verifier)). PKCE S256 only — never `plain`. */
  codeChallenge: string;
  /** OIDC nonce. Apple and Google both accept it; it binds the id_token. */
  nonce?: string;
}

export interface ExchangeCodeInput {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  /**
   * The static secret from env for every remaining provider.
   *
   * (Apple was the exception — it had no static secret and needed a JWT
   * minted per request. If Apple is re-added, this field becomes the place
   * to pass that minted value, exactly as it did before.)
   */
  clientSecret: string;
}

export interface FetchIdentityInput {
  accessToken: string;
  /** Present when the provider returned one (Google with `openid`). */
  idToken?: string;
  /**
   * The OIDC client id. Required whenever an id_token is verified, because
   * `aud` is the ONLY claim that proves the token was minted for THIS
   * application. Without it, a token issued to a different client of the
   * same provider would verify, and an attacker who controls any OAuth
   * client of that provider could present their own users' tokens to us.
   */
  clientId: string;
  /** The nonce we sent on the authz request, when we sent one. */
  nonce?: string;
}

export interface OAuthAdapter extends ProviderMeta {
  authorizationUrl(input: AuthorizationUrlInput): string;
  exchangeCode(input: ExchangeCodeInput): Promise<OAuthTokens>;
  fetchIdentity(input: FetchIdentityInput): Promise<OAuthIdentity>;
}

/**
 * A provider answered with something we will not accept.
 *
 * Carries no response body: provider errors can echo the authorization
 * code, and that code is a bearer credential for one exchange. Only the
 * status and a short, fixed reason travel.
 */
export class OAuthProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    readonly reason: string,
  ) {
    super(`${provider}: ${reason} (${status})`);
    this.name = 'OAuthProviderError';
  }
}

/** Every provider call is bounded — a hanging callback holds a slot. */
export const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * `fetch` with the two things every provider call needs: a hard timeout and
 * an explicit Accept. Returns the raw Response; the caller decides what a
 * non-2xx means, because the three providers disagree.
 *
 * NOTE: no User-Agent spoofing here. The upstream gateway needs one (it sits
 * behind Cloudflare), the identity providers do not.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      // A provider call must never be cached by anything.
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalise `email_verified` across providers.
 *
 * Google sends a boolean; GitHub expresses it per-address as `verified`.
 * Anything else — missing, null, "false", a number — is NOT verified,
 * because the failure mode of guessing wrong is account takeover (an
 * unverified address auto-links to an existing user).
 */
export function isVerifiedClaim(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}
