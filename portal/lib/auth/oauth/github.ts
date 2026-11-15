/**
 * GitHub — OAuth 2.0, no OIDC, and TWO calls to learn the email.
 *
 * Three things here differ from Google in ways that break a copy-pasted
 * adapter:
 *
 *   1. `/user` returns `email: null` whenever the address is private, which
 *      is the DEFAULT for most accounts. The address lives at `/user/emails`
 *      instead, and reading it needs the `user:email` scope.
 *   2. `/user/emails` returns an ARRAY with `primary` and `verified` per
 *      entry. Taking `emails[0]` picks an arbitrary one — often an
 *      unverified legacy address — so the selection rule is "primary AND
 *      verified", and there is no fallback to an unverified address.
 *   3. `id` is a NUMBER and `login` can be RENAMED by the user. The account
 *      id is the number, stringified; using the login would silently break
 *      a returning user's sign-in the day they rename themselves.
 *
 * GitHub's token exchange returns `application/x-www-form-urlencoded` unless
 * `Accept: application/json` is sent — the default is the URL-encoded form,
 * which `res.json()` would throw on.
 */
import {
  OAuthProviderError,
  providerFetch,
  type OAuthAdapter,
  type OAuthIdentity,
  type OAuthTokens,
} from './types';

const AUTHZ = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const USER = 'https://api.github.com/user';
const EMAILS = 'https://api.github.com/user/emails';

/**
 * `read:user` gives the profile; `user:email` is what makes the address
 * readable when it is private. Omitting the scope does not fail — it
 * returns null email, which fails silently at the linking step.
 */
const SCOPE = 'read:user user:email';

const HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
} as const;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

interface GithubUser {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  avatar_url?: unknown;
  email?: unknown;
}

interface GithubEmail {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

export const githubAdapter: OAuthAdapter = {
  id: 'github',
  name: 'GitHub',
  authorizationEndpoint: AUTHZ,
  scope: SCOPE,

  authorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // `allow_signup` is default-true and lets a user create a GitHub
      // account mid-flow; leaving it default is intentional — the user
      // gets a GitHub account they can actually use afterwards.
    });
    return `${AUTHZ}?${p.toString()}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier, clientId, clientSecret }): Promise<OAuthTokens> {
    const res = await providerFetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!res.ok) {
      throw new OAuthProviderError('github', res.status, 'token exchange failed');
    }

    const body = (await res.json()) as {
      access_token?: unknown;
      // GitHub returns 200 with `{ error: "bad_verification_code" }` for a
      // bad code. A response that only checks `res.ok` treats that as
      // success with an undefined token, and the next call 401s somewhere
      // far from the cause.
      error?: unknown;
      scope?: unknown;
      token_type?: unknown;
    };

    if (body.error) {
      throw new OAuthProviderError('github', res.status, 'token exchange rejected');
    }
    const accessToken = str(body.access_token);
    if (!accessToken) {
      throw new OAuthProviderError('github', res.status, 'token response had no access_token');
    }
    return {
      accessToken,
      // No id_token: GitHub is not an OIDC provider. Identity is proven by
      // the access token alone, which is why every call below is over TLS
      // to api.github.com and nowhere else.
      scope: str(body.scope) ?? undefined,
      tokenType: str(body.token_type) ?? undefined,
    };
  },

  async fetchIdentity({ accessToken }): Promise<OAuthIdentity> {
    const auth = { ...HEADERS, authorization: `Bearer ${accessToken}` };

    const userRes = await providerFetch(USER, { headers: auth });
    if (!userRes.ok) {
      throw new OAuthProviderError('github', userRes.status, 'user fetch failed');
    }
    const user = (await userRes.json()) as GithubUser;

    // `id` is a number. A string here would compare unequal to itself on
    // the next sign-in and create a second account, so the type is checked
    // rather than coerced.
    const id =
      typeof user.id === 'number' ? String(user.id)
      : typeof user.id === 'string' && user.id.length > 0 ? user.id
      : null;
    if (!id) {
      throw new OAuthProviderError('github', 200, 'user fetch returned no id');
    }

    // The second call. Its failure is NOT fatal: a user with a public email
    // on the profile can still sign in, and a 403 (scope not granted, e.g.
    // an OAuth App that was edited after the user authorised) must not
    // break sign-in for everyone. It degrades to "no verified address",
    // which the linking rule treats as unlinked.
    let email: string | null = null;
    let emailVerified = false;
    try {
      const emailsRes = await providerFetch(EMAILS, { headers: auth });
      if (emailsRes.ok) {
        const list = (await emailsRes.json()) as unknown;
        if (Array.isArray(list)) {
          const chosen = (list as GithubEmail[]).find(
            (e) => e.primary === true && e.verified === true && typeof e.email === 'string',
          );
          if (chosen) {
            email = str(chosen.email);
            emailVerified = true;
          }
        }
      }
    } catch {
      // Timeout or transport failure on the SECOND call. Keep the profile
      // we already have; the identity is simply unverified.
    }

    // Only when the emails call told us nothing do we fall back to the
    // profile field — and even then `verified` stays FALSE. GitHub does not
    // promise the profile email is verified, and treating it as verified is
    // exactly the takeover path §2.3 clause 3 forbids.
    if (!email) {
      email = str(user.email);
    }

    return {
      providerAccountId: id,
      email,
      emailVerified,
      name: str(user.name) ?? str(user.login),
      image: str(user.avatar_url),
      login: str(user.login),
      isPrivateRelay: false,
    };
  },
};
