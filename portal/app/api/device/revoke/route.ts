/**
 * POST /api/device/revoke — end the credential the app is signed in with.
 *
 * Signing out used to delete only the local copy in the OS keychain. The key
 * itself stayed valid upstream until its 30-day expiry, so anyone who had
 * extracted it kept access after the user believed they had signed out.
 *
 * The desktop has no browser session and cannot call the dashboard's
 * DELETE /api/keys/[id]. This is the device-authenticated equivalent: the
 * bearer IS the credential being revoked, so presenting it is the whole proof
 * of ownership — there is no other key it can revoke, and no id to guess.
 *
 * Revocation runs gateway-first, then locally, matching revokeApiKey: if the
 * upstream call fails the local row stays valid, which is the safe order. A
 * local-only revoke would leave the gateway accepting a key the dashboard
 * shows as gone.
 *
 * Idempotent by design: a second call answers 200 rather than 409. The app
 * must be able to retry sign-out after a network failure without having to
 * distinguish "already revoked" from "never existed".
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { gateway } from '@/lib/keys/gateway';
import { errorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The zn- shape the device flow issues. Anything else is not our credential. */
const KEY_SHAPE = /^zn-[A-Za-z0-9_-]{16,}$/;

interface CredentialRow extends Record<string, unknown> {
  id: string;
  litellm_key_hash: string | null;
  revoked_at: string | Date | null;
}

async function credentialFor(plaintext: string): Promise<CredentialRow | null> {
  // api_keys.key_hash stores the SHA-256 hex of the plaintext, never the
  // plaintext itself, so the lookup has to hash before comparing.
  const hash = createHash('sha256').update(plaintext, 'utf8').digest('hex');
  const [row] = await db.execute<CredentialRow>(sql`
    SELECT ak.id, ak.litellm_key_hash, ak.revoked_at
      FROM api_keys ak
     WHERE ak.key_hash = ${hash}
     LIMIT 1
  `);
  return row ?? null;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const header = request.headers.get('authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!KEY_SHAPE.test(bearer)) {
      return Response.json({ error: { code: 'unauthorized', message: 'Missing device key.' } }, { status: 401 });
    }

    const credential = await credentialFor(bearer);
    // A key that is not ours, or one already fully revoked, is indistinguishable
    // here: both mean "this credential holds no authority". Answer 401 so the
    // app clears its copy instead of retrying forever.
    if (!credential) {
      return Response.json({ error: { code: 'unauthorized', message: 'Unknown device key.' } }, { status: 401 });
    }

    if (!credential.revoked_at && credential.litellm_key_hash) {
      // Upstream first. If this throws, the local row stays unrevoked and the
      // client can retry — the alternative would strand a live gateway key
      // behind a locally "revoked" row.
      await gateway.revoke(credential.litellm_key_hash);
    }

    await db.execute(sql`
      UPDATE api_keys
         SET revoked_at = COALESCE(revoked_at, now())
       WHERE id = ${credential.id}
    `);

    return Response.json({ revoked: true });
  } catch (e) {
    return errorResponse(e);
  }
}
