/**
 * Provider adapters and the normalisation table — plan §8 items 2 and 4.
 *
 * Pure: no network, no database. Every `fetch` is stubbed with a recorded
 * shape, because the interesting cases are the ones a real account cannot
 * be made to produce on demand:
 *
 *   - GitHub with `email: null` on /user (the DEFAULT for private accounts)
 *   - GitHub with only unverified addresses at /user/emails
 *   - Apple with `email_verified: "true"` as a STRING and `is_private_email`
 *     likewise — the case where `if (claims.email_verified)` is true for
 *     the string "false"
 *
 * The normalisation rule is the security boundary: `emailVerified` gates
 * whether an OAuth identity may link to an existing account, and getting it
 * wrong hands one person another person's account.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isVerifiedClaim } from '@/lib/auth/oauth/types';
import { githubAdapter } from '@/lib/auth/oauth/github';
import { googleAdapter } from '@/lib/auth/oauth/google';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stub `fetch` with a queue of responses, in call order. */
function stubFetch(...responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = responses[i++] ?? { ok: false, status: 500, body: {} };
      return {
        ok: r.ok,
        status: r.status,
        json: async () => r.body,
      } as unknown as Response;
    }),
  );
  return calls;
}

describe('isVerifiedClaim — the normalisation that gates account linking', () => {
  it('accepts a boolean true (Google)', () => {
    expect(isVerifiedClaim(true)).toBe(true);
  });

  it('accepts the STRING "true" (Apple)', () => {
    expect(isVerifiedClaim('true')).toBe(true);
    expect(isVerifiedClaim('TRUE')).toBe(true);
  });

  it('rejects the STRING "false" — the bug this exists for', () => {
    // `if (claims.email_verified)` is TRUE for the string "false", which
    // would auto-link an unverified Apple address to an existing account.
    expect(isVerifiedClaim('false')).toBe(false);
    expect(isVerifiedClaim('FALSE')).toBe(false);
  });

  it('rejects anything absent or unexpected', () => {
    expect(isVerifiedClaim(undefined)).toBe(false);
    expect(isVerifiedClaim(null)).toBe(false);
    expect(isVerifiedClaim(0)).toBe(false);
    expect(isVerifiedClaim(1)).toBe(false);
    expect(isVerifiedClaim('')).toBe(false);
    expect(isVerifiedClaim('yes')).toBe(false);
  });
});

describe('githubAdapter.fetchIdentity — the two-call email', () => {
  it('uses the primary verified address from /user/emails when /user hides it', async () => {
    const calls = stubFetch(
      // /user — email null, which is what a private address looks like.
      {
        ok: true,
        status: 200,
        body: {
          id: 12345678,
          login: 'octocat',
          name: 'The Octocat',
          avatar_url: 'https://avatars.example/u/1',
          email: null,
        },
      },
      // /user/emails — one unverified legacy, one primary+verified.
      {
        ok: true,
        status: 200,
        body: [
          { email: 'old@example.com', primary: false, verified: true, visibility: 'public' },
          { email: 'real@example.com', primary: true, verified: true, visibility: 'private' },
        ],
      },
    );

    const identity = await githubAdapter.fetchIdentity({ accessToken: 't', clientId: 'c' });

    expect(identity.providerAccountId).toBe('12345678');
    // The NUMERIC id, stringified. A login would break when renamed.
    expect(identity.providerAccountId).not.toBe('octocat');
    expect(identity.email).toBe('real@example.com');
    expect(identity.emailVerified).toBe(true);
    expect(identity.login).toBe('octocat');
    expect(identity.name).toBe('The Octocat');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe('https://api.github.com/user/emails');
  });

  it('marks an identity UNVERIFIED when no primary+verified address exists', async () => {
    stubFetch(
      {
        ok: true,
        status: 200,
        body: { id: 9, login: 'u', name: null, avatar_url: null, email: null },
      },
      {
        ok: true,
        status: 200,
        body: [
          { email: 'a@example.com', primary: true, verified: false },
          { email: 'b@example.com', primary: false, verified: true },
        ],
      },
    );

    const identity = await githubAdapter.fetchIdentity({ accessToken: 't', clientId: 'c' });

    // NO fallback to an unverified address: that is the takeover path.
    expect(identity.emailVerified).toBe(false);
    expect(identity.email).toBeNull();
  });

  it('survives a 403 on /user/emails (scope revoked) as unverified, not a throw', async () => {
    stubFetch(
      {
        ok: true,
        status: 200,
        body: { id: 7, login: 'u', name: 'U', avatar_url: null, email: 'public@example.com' },
      },
      { ok: false, status: 403, body: { message: 'Resource not accessible' } },
    );

    const identity = await githubAdapter.fetchIdentity({ accessToken: 't', clientId: 'c' });

    // The profile email is used for DISPLAY but still unverified.
    expect(identity.email).toBe('public@example.com');
    expect(identity.emailVerified).toBe(false);
  });

  it('falls back to name || login so the profile is never nameless', async () => {
    stubFetch(
      { ok: true, status: 200, body: { id: 5, login: 'handle', name: null, avatar_url: null, email: null } },
      { ok: true, status: 200, body: [] },
    );

    const identity = await githubAdapter.fetchIdentity({ accessToken: 't', clientId: 'c' });
    expect(identity.name).toBe('handle');
  });
});

describe('githubAdapter.exchangeCode — the 200-with-an-error shape', () => {
  it('treats a 200 carrying `error` as a failure, not a tokenless success', async () => {
    stubFetch({ ok: true, status: 200, body: { error: 'bad_verification_code' } });

    await expect(
      githubAdapter.exchangeCode({
        code: 'c',
        redirectUri: 'http://x/cb',
        codeVerifier: 'v',
        clientId: 'id',
        clientSecret: 's',
      }),
    ).rejects.toThrow(/token exchange rejected/);
  });

  it('sends Accept: application/json so the token comes back as JSON', async () => {
    const calls = stubFetch({
      ok: true,
      status: 200,
      body: { access_token: 'gho_x', scope: 'read:user,user:email', token_type: 'bearer' },
    });

    await githubAdapter.exchangeCode({
      code: 'c',
      redirectUri: 'http://x/cb',
      codeVerifier: 'v',
      clientId: 'id',
      clientSecret: 's',
    });

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.accept).toBe('application/json');
  });
});

describe('googleAdapter — boolean email_verified, sub-keyed', () => {
  it('reads sub/email/email_verified/name/picture from userinfo', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: {
        sub: '110169484474386276334',
        email: 'user@example.com',
        email_verified: true,
        name: 'User Name',
        picture: 'https://lh3.example/a',
      },
    });

    const identity = await googleAdapter.fetchIdentity({
      accessToken: 't',
      clientId: 'client-id.apps.googleusercontent.com',
    });

    expect(identity.providerAccountId).toBe('110169484474386276334');
    expect(identity.email).toBe('user@example.com');
    expect(identity.emailVerified).toBe(true);
    expect(identity.login).toBeNull();
    expect(identity.isPrivateRelay).toBe(false);
  });

  it('reports unverified when Google says false', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: { sub: '1', email: 'u@example.com', email_verified: false },
    });

    const identity = await googleAdapter.fetchIdentity({ accessToken: 't', clientId: 'c' });
    expect(identity.emailVerified).toBe(false);
  });

  it('throws when userinfo returns no sub, rather than inventing an id', async () => {
    stubFetch({ ok: true, status: 200, body: { email: 'u@example.com', email_verified: true } });

    await expect(googleAdapter.fetchIdentity({ accessToken: 't', clientId: 'c' })).rejects.toThrow(
      /no sub/,
    );
  });

  it('rejects a FORGED id_token instead of silently falling back to userinfo', async () => {
    // A token that is not a JWT at all. Falling back to userinfo would turn
    // a tampered id_token into a successful sign-in.
    const calls = stubFetch();

    await expect(
      googleAdapter.fetchIdentity({ accessToken: 't', idToken: 'not-a-jwt', clientId: 'c' }),
    ).rejects.toThrow(/id_token failed verification/);

    // And it made no network call to userinfo — no fallback happened.
    expect(calls).toHaveLength(0);
  });
});

describe('googleAdapter.authorizationUrl — PKCE and account chooser', () => {
  it('always sends S256, state, and prompt=select_account', () => {
    const url = new URL(
      googleAdapter.authorizationUrl({
        clientId: 'cid',
        redirectUri: 'https://zaino.soon.it/api/oauth/google/callback',
        state: 'st',
        codeChallenge: 'chal',
      }),
    );

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    // Without this, a shared browser silently reuses the last account.
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // No trailing slash, and the exact path the console entry must match.
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://zaino.soon.it/api/oauth/google/callback',
    );
  });

  it('includes the nonce when one was generated', () => {
    const url = new URL(
      googleAdapter.authorizationUrl({
        clientId: 'cid',
        redirectUri: 'https://x/cb',
        state: 'st',
        codeChallenge: 'chal',
        nonce: 'nonce-123',
      }),
    );
    expect(url.searchParams.get('nonce')).toBe('nonce-123');
  });
});

describe('githubAdapter.authorizationUrl — the scope that makes email readable', () => {
  it('requests user:email, without which every private address is null', () => {
    const url = new URL(
      githubAdapter.authorizationUrl({
        clientId: 'cid',
        redirectUri: 'https://x/cb',
        state: 'st',
        codeChallenge: 'chal',
      }),
    );
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('user:email');
    expect(scope).toContain('read:user');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
