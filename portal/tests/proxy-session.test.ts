/**
 * `lib/auth/session-token.ts` must read exactly what Auth.js writes.
 *
 * THE FAILURE THIS PREVENTS, in both directions:
 *
 *   - it accepts a token Auth.js would not: the proxy lets an unauthenticated
 *     request reach a route, which is the bug the whole layer exists for;
 *   - it rejects a token Auth.js accepts: every customer is locked out of
 *     their own dashboard.
 *
 * So the comparison is against TOKENS AUTH.JS ITSELF MINTED
 * (`encode` from `next-auth/jwt`, the same call `auth.ts` issues from), not
 * against a re-implementation. The one copy of the algorithm lives in
 * `lib/auth/session-token.ts`; this file proves it is the same algorithm.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SECRET = 'proxy-agreement-test-secret-not-a-real-deployment-key';
const PREVIOUS = { AUTH_SECRET: process.env.AUTH_SECRET, AUTH_URL: process.env.AUTH_URL };

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
  process.env.AUTH_URL = 'https://portal.test';
});

afterAll(() => {
  if (PREVIOUS.AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = PREVIOUS.AUTH_SECRET;
  if (PREVIOUS.AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = PREVIOUS.AUTH_URL;
});

/** Mint a token exactly as `auth.ts` does: sub + email + freshness stamp. */
async function mint(payload: Record<string, unknown>, opts: { secret?: string; secure?: boolean; maxAge?: number } = {}) {
  const { encode } = await import('next-auth/jwt');
  const secure = opts.secure ?? true;
  const cookieName = secure ? '__Secure-authjs.session-token' : 'authjs.session-token';
  return encode({
    token: payload,
    secret: opts.secret ?? SECRET,
    salt: cookieName,
    maxAge: opts.maxAge ?? 3600,
  });
}

describe('the decode agrees with Auth.js', () => {
  it('accepts a token Auth.js minted, and reads its subject', async () => {
    const { sessionFromHeaders, sessionCookieName } = await import('@/lib/auth/session-token');
    const token = await mint({ sub: 'user-1', email: 'a@b.test', pwdAt: null });

    const session = await sessionFromHeaders(
      new Headers({ cookie: `${sessionCookieName()}=${token}` }),
    );
    expect(session?.sub).toBe('user-1');
    expect(session?.email).toBe('a@b.test');
  });

  it('refuses a token signed with another secret', async () => {
    const { decodeSessionToken } = await import('@/lib/auth/session-token');
    const foreign = await mint({ sub: 'attacker' }, { secret: 'a-different-deployment' });
    expect(await decodeSessionToken(foreign)).toBeNull();
  });

  it('refuses an expired token', async () => {
    const { decodeSessionToken } = await import('@/lib/auth/session-token');
    const stale = await mint({ sub: 'user-1' }, { maxAge: -120 });
    expect(await decodeSessionToken(stale)).toBeNull();
  });

  it('refuses a token that decrypts but carries no subject', async () => {
    // A decryptable token without `sub` is not an identity this deployment
    // issues. Treating it as a session would mean a route running with no
    // user id behind it.
    const { decodeSessionToken } = await import('@/lib/auth/session-token');
    const anonymous = await mint({ email: 'nobody@test' });
    expect(await decodeSessionToken(anonymous)).toBeNull();
  });

  it('refuses garbage rather than throwing', async () => {
    const { decodeSessionToken } = await import('@/lib/auth/session-token');
    for (const bad of ['', 'not-a-jwt', 'a.b.c', 'x'.repeat(2000)]) {
      await expect(decodeSessionToken(bad)).resolves.toBeNull();
    }
  });
});

describe('the cookie name follows the deployment', () => {
  it('uses the __Secure- prefix when AUTH_URL is https', async () => {
    const { sessionCookieName } = await import('@/lib/auth/session-token');
    process.env.AUTH_URL = 'https://portal.test';
    expect(sessionCookieName()).toBe('__Secure-authjs.session-token');
  });

  it('uses the bare name when AUTH_URL is http (local `next dev`)', async () => {
    const { sessionCookieName } = await import('@/lib/auth/session-token');
    process.env.AUTH_URL = 'http://127.0.0.1:3000';
    expect(sessionCookieName()).toBe('authjs.session-token');
    // And a token minted against that name still reads, so a local session
    // is not refused by the production-shaped path.
    const { sessionFromHeaders } = await import('@/lib/auth/session-token');
    const token = await mint({ sub: 'local' }, { secure: false });
    const session = await sessionFromHeaders(
      new Headers({ cookie: `authjs.session-token=${token}` }),
    );
    expect(session?.sub).toBe('local');
    process.env.AUTH_URL = 'https://portal.test';
  });
});

describe('chunked cookies', () => {
  it('joins .0/.1/... in numeric order, not lexical', async () => {
    // Auth.js splits a token larger than one cookie (>4096 bytes) into
    // `name.0`, `name.1` … String sort puts `.10` before `.2`, which would
    // splice the token into unreadable garbage. Prove the numeric order
    // round-trips by padding the token past the chunk size.
    const { sessionFromHeaders, sessionCookieName } = await import('@/lib/auth/session-token');
    const name = sessionCookieName();
    const token = await mint({
      sub: 'chunky',
      email: 'chunky@test',
      pad: 'x'.repeat(6000),
    });

    // Split into 4000-byte chunks exactly as the SessionStore re-joins them.
    const chunks: string[] = [];
    for (let i = 0; i < token.length; i += 4000) chunks.push(token.slice(i, i + 4000));
    const cookie = chunks.map((c, i) => `${name}.${i}=${c}`).join('; ');
    const reversed = chunks
      .map((c, i) => `${name}.${i}=${c}`)
      .reverse()
      .join('; ');

    expect((await sessionFromHeaders(new Headers({ cookie })))?.sub).toBe('chunky');
    // Order on the wire must not matter.
    expect((await sessionFromHeaders(new Headers({ cookie: reversed })))?.sub).toBe('chunky');
  });
});
