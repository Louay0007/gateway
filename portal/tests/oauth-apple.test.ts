/**
 * Apple — the client-secret JWT and the string-typed claims. Plan §8 items
 * 2 and 4.
 *
 * Two failure modes are silent in production and therefore tested here:
 *
 *   1. A secret JWT with the wrong `iss`/`sub`/`aud`, or an `exp` past six
 *      months, is accepted by `jose` and rejected by Apple with
 *      `invalid_client` — after the user has consented.
 *   2. `email_verified: "false"` (a string) is truthy. Trusting it links an
 *      unverified address to an existing account, which is account takeover.
 *
 * A real ES256 key is generated per run so the signature is actually
 * verified end to end — a hardcoded key would prove nothing about the
 * signing path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SignJWT,
  generateKeyPair,
  exportPKCS8,
  exportJWK,
  importPKCS8,
  jwtVerify,
  decodeProtectedHeader,
} from 'jose';

/**
 * jose v6 dropped the `KeyLike` alias; a signing key is a WebCrypto
 * CryptoKey. Named locally so the test reads the same as the adapter.
 */
type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;

/** A JWK plus the `kid`/`alg`/`use` a JWKS entry carries. */
type PublishedKey = JsonWebKey & { kid?: string };
import {
  createAppleAdapter,
  mintAppleClientSecret,
  readAppleCredentials,
  type AppleCredentials,
} from '@/lib/auth/oauth/apple';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SERVICES_ID = 'ai.zaino.desktop.web';

interface KeyMaterial {
  creds: AppleCredentials;
  /** The public half, already a JWK — what Apple's JWKS would serve. */
  publicJwk: PublishedKey;
  privateKey: SigningKey;
}

/**
 * A fresh P-256 pair in the shape a .p8 arrives in (PKCS#8 PEM).
 *
 * The PUBLIC half is exported here, from the generated pair, rather than
 * re-derived from the PEM: `importPKCS8` yields a NON-extractable key, so
 * asking it for its JWK throws `InvalidAccessError`. Keeping both halves
 * from one `generateKeyPair` call is also what makes the JWKS stub and the
 * signer provably the same key.
 */
async function freshKeys(): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const pem = await exportPKCS8(privateKey);
  const publicJwk = (await exportJWK(publicKey)) as JsonWebKey;
  return {
    creds: { teamId: 'TEAM123456', servicesId: SERVICES_ID, keyId: 'KEY1234567', privateKey: pem },
    publicJwk: { ...publicJwk, kid: 'KEY1234567', alg: 'ES256', use: 'sig' } as PublishedKey,
    privateKey: await importPKCS8(pem, 'ES256'),
  };
}

/**
 * A local key resolver serving exactly one key.
 *
 * Preferred over the JS-imported stub for the tests that must run
 * independently: the adapter's default resolver is a per-process cache
 * (correct in production, useless under test), so each test injects its own
 * key rather than sharing one.
 */
function localResolver(publicJwk: PublishedKey) {
  return async (protectedHeader: { kid?: string }) => {
    if (protectedHeader.kid && protectedHeader.kid !== publicJwk.kid) {
      throw new Error('no matching key');
    }
    return publicJwk as never;
  };
}

/** Sign an Apple-shaped id_token with a given key and claim set. */
async function signedIdToken(
  key: SigningKey,
  claims: Record<string, unknown>,
  opts: { audience?: string; kid?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: opts.kid ?? 'KEY1234567' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(opts.audience ?? SERVICES_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(key);
}

describe('mintAppleClientSecret', () => {
  it('signs ES256 with the exact Apple claims and a ≤6-month expiry', async () => {
    const { creds, publicJwk } = await freshKeys();
    const secret = await mintAppleClientSecret(creds);

    // The header must carry the Key ID: Apple matches the key by `kid`.
    const header = decodeProtectedHeader(secret);
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe('KEY1234567');

    // Verify against the public half — proves the signature, not just the
    // presence of three dot-separated segments.
    const { payload } = await jwtVerify(secret, publicJwk as never, {
      issuer: 'TEAM123456',
      subject: SERVICES_ID,
      audience: 'https://appleid.apple.com',
    });

    const sixMonths = 180 * 24 * 60 * 60;
    const lifetime = (payload.exp ?? 0) - (payload.iat ?? 0);
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(sixMonths + 5);
  });

  it('mints a NEW value on every call (Apple caps the lifetime)', async () => {
    const { creds } = await freshKeys();
    const a = await mintAppleClientSecret(creds);
    // `iat` is second-resolution, so advance the clock to prove the value
    // is minted per request rather than cached from a module constant.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);
    const b = await mintAppleClientSecret(creds);
    vi.useRealTimers();
    expect(a).not.toBe(b);
  });
});

describe('readAppleCredentials — the three .env shapes', () => {
  it('returns null when any part is missing', () => {
    expect(readAppleCredentials({})).toBeNull();
    expect(
      readAppleCredentials({ APPLE_TEAM_ID: 'T', APPLE_SERVICES_ID: 'S', APPLE_KEY_ID: 'K' }),
    ).toBeNull();
  });

  it('accepts a real multi-line PEM', async () => {
    const { creds } = await freshKeys();
    const read = readAppleCredentials({
      APPLE_TEAM_ID: 'T',
      APPLE_SERVICES_ID: 'S',
      APPLE_KEY_ID: 'K',
      APPLE_PRIVATE_KEY: creds.privateKey,
    });
    expect(read).not.toBeNull();
    expect(read!.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(read!.privateKey).toContain('\n');
  });

  it('accepts literal \\n (the common single-line .env paste)', async () => {
    const { creds } = await freshKeys();
    const read = readAppleCredentials({
      APPLE_TEAM_ID: 'T',
      APPLE_SERVICES_ID: 'S',
      APPLE_KEY_ID: 'K',
      APPLE_PRIVATE_KEY: creds.privateKey.replace(/\n/g, '\\n'),
    });
    expect(read).not.toBeNull();
    expect(read!.privateKey).toContain('\n');
    expect(read!.privateKey).not.toContain('\\n');
  });

  it('accepts base64 of the whole PEM', async () => {
    const { creds } = await freshKeys();
    const read = readAppleCredentials({
      APPLE_TEAM_ID: 'T',
      APPLE_SERVICES_ID: 'S',
      APPLE_KEY_ID: 'K',
      APPLE_PRIVATE_KEY: Buffer.from(creds.privateKey, 'utf8').toString('base64'),
    });
    expect(read).not.toBeNull();
    expect(read!.privateKey).toContain('BEGIN PRIVATE KEY');
  });

  it('returns null for a value that is neither PEM nor base64 PEM', () => {
    expect(
      readAppleCredentials({
        APPLE_TEAM_ID: 'T',
        APPLE_SERVICES_ID: 'S',
        APPLE_KEY_ID: 'K',
        APPLE_PRIVATE_KEY: 'not a key',
      }),
    ).toBeNull();
  });
});

describe('apple adapter authorisation URL', () => {
  it('uses form_post, because Apple POSTs the callback', async () => {
    const { creds } = await freshKeys();
    const url = new URL(
      createAppleAdapter(creds).authorizationUrl({
        clientId: SERVICES_ID,
        redirectUri: 'https://zaino.soon.it/api/oauth/apple/callback',
        state: 'st',
        codeChallenge: 'chal',
        nonce: 'n1',
      }),
    );

    // A route that only exports GET answers this provider with 405.
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('nonce')).toBe('n1');
    expect(url.searchParams.get('scope')).toBe('name email');
  });
});

describe('apple adapter fetchIdentity — string claims and the one-time name', () => {
  it('treats the STRING "false" as unverified', async () => {
    const keys = await freshKeys();
    const token = await signedIdToken(keys.privateKey, {
      sub: 'apple-sub-1',
      email: 'u@example.com',
      email_verified: 'false',
      is_private_email: 'false',
    });

    const identity = await createAppleAdapter(keys.creds, localResolver(keys.publicJwk)).fetchIdentity({
      accessToken: 'a',
      idToken: token,
      clientId: SERVICES_ID,
    });

    expect(identity.emailVerified).toBe(false);
    expect(identity.isPrivateRelay).toBe(false);
  });

  it('treats the STRING "true" as verified, and flags a relay address', async () => {
    const keys = await freshKeys();
    const token = await signedIdToken(keys.privateKey, {
      sub: 'apple-sub-2',
      email: 'xyz@privaterelay.appleid.com',
      email_verified: 'true',
      is_private_email: 'true',
    });

    const identity = await createAppleAdapter(keys.creds, localResolver(keys.publicJwk)).fetchIdentity({
      accessToken: 'a',
      idToken: token,
      clientId: SERVICES_ID,
    });

    expect(identity.emailVerified).toBe(true);
    expect(identity.isPrivateRelay).toBe(true);
  });

  it('flags a relay address even when is_private_email is absent', async () => {
    const keys = await freshKeys();
    const token = await signedIdToken(keys.privateKey, {
      sub: 'apple-sub-3',
      email: 'abc@privaterelay.appleid.com',
      email_verified: 'true',
    });

    const identity = await createAppleAdapter(keys.creds, localResolver(keys.publicJwk)).fetchIdentity({
      accessToken: 'a',
      idToken: token,
      clientId: SERVICES_ID,
    });

    // Derived from the domain as well, so an omitted claim cannot make a
    // relay address look corporate.
    expect(identity.isPrivateRelay).toBe(true);
  });

  it('uses the one-time POST name, then is nameless forever after', async () => {
    const keys = await freshKeys();
    const token = await signedIdToken(keys.privateKey, {
      sub: 'apple-sub-4',
      email: 'u@example.com',
      email_verified: 'true',
    });
    const adapter = createAppleAdapter(keys.creds, localResolver(keys.publicJwk));

    const first = await adapter.fetchIdentity({
      accessToken: 'a',
      idToken: token,
      clientId: SERVICES_ID,
      initialName: { firstName: 'Ada', lastName: 'Lovelace' },
    });
    expect(first.name).toBe('Ada Lovelace');

    // Second consent: Apple sends no `user` blob at all.
    const second = await adapter.fetchIdentity({
      accessToken: 'a',
      idToken: token,
      clientId: SERVICES_ID,
      initialName: null,
    });
    expect(second.name).toBeNull();
  });

  it('handles a partial name (Apple sometimes sends only a first name)', async () => {
    const keys = await freshKeys();
    const token = await signedIdToken(keys.privateKey, {
      sub: 's5',
      email: 'u@example.com',
      email_verified: 'true',
    });

    const identity = await createAppleAdapter(keys.creds, localResolver(keys.publicJwk)).fetchIdentity({
      accessToken: 'a',
      idToken: token,
      clientId: SERVICES_ID,
      initialName: { firstName: 'Ada' },
    });
    expect(identity.name).toBe('Ada');
    expect(identity.image).toBeNull();
  });

  it('rejects an id_token minted for a DIFFERENT client (aud mismatch)', async () => {
    const keys = await freshKeys();
    const foreign = await signedIdToken(
      keys.privateKey,
      { sub: 's', email: 'u@example.com', email_verified: 'true' },
      { audience: 'ai.someoneelse.web' },
    );

    await expect(
      createAppleAdapter(keys.creds, localResolver(keys.publicJwk)).fetchIdentity({
        accessToken: 'a',
        idToken: foreign,
        clientId: SERVICES_ID,
      }),
    ).rejects.toThrow(/failed verification/);
  });

  it('rejects a token whose nonce does not match the flow', async () => {
    const keys = await freshKeys();
    const token = await signedIdToken(keys.privateKey, {
      sub: 's6',
      email: 'u@example.com',
      email_verified: 'true',
      nonce: 'attacker-nonce',
    });

    await expect(
      createAppleAdapter(keys.creds, localResolver(keys.publicJwk)).fetchIdentity({
        accessToken: 'a',
        idToken: token,
        clientId: SERVICES_ID,
        nonce: 'our-nonce',
      }),
    ).rejects.toThrow(/nonce mismatch/);
  });

  it('rejects a token signed by a key Apple does not publish', async () => {
    const keys = await freshKeys();
    const attacker = await freshKeys();
    // The JWKS serves OUR key, the token is signed by the attacker's.
    const forged = await signedIdToken(attacker.privateKey, {
      sub: 's7',
      email: 'victim@example.com',
      email_verified: 'true',
    });

    await expect(
      createAppleAdapter(keys.creds, localResolver(keys.publicJwk)).fetchIdentity({
        accessToken: 'a',
        idToken: forged,
        clientId: SERVICES_ID,
      }),
    ).rejects.toThrow(/failed verification/);
  });
});
