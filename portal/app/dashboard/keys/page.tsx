import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { entitlements } from '@/db/schema';
import { requirePageActiveOrg, userByEmail } from '@/lib/auth/authorize';
import { ensureSessionReady } from '@/lib/auth/provision';
import { listKeys } from '@/lib/keys';
import KeysManager from './KeysManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Keys' };

/**
 * API keys — C-05, Phase 3.
 *
 * The page reads through the service (same code path the API uses) rather
 * than fetching its own API: one implementation of "which keys may this
 * org see", and no internal HTTP round trip per dashboard load.
 *
 * `allowedModels` / `maxKeys` come from the cached entitlement spec — the
 * same numbers the gateway enforces — so the checkboxes cannot drift from
 * the limits a new key actually gets.
 */
export default async function Page() {
  const session = await auth();
  if (!session?.user?.email) redirect('/sign-in');

  // Await provisioning before reading memberships: the layout and this
  // page render concurrently, so a first-time user must not be bounced
  // before their org exists. See ensureSessionReady.
  const current = await userByEmail(session.user.email);
  if (current) await ensureSessionReady(current.id);

  const ctx = await requirePageActiveOrg();

  const [result, entitlement] = await Promise.all([
    listKeys({ organizationId: ctx.orgId, userId: ctx.userId }),
    db.query.entitlements.findFirst({
      where: eq(entitlements.organizationId, ctx.orgId),
    }),
  ]);

  const effective = (entitlement?.effective ?? {}) as Record<string, unknown>;
  const allowedModels = Array.isArray(effective.models)
    ? effective.models.filter((m): m is string => typeof m === 'string')
    : [];
  const maxKeys = typeof effective.maxKeys === 'number' ? effective.maxKeys : 1;

  // The quickstart snippet must point at the GATEWAY, not the portal —
  // API_DOMAIN is the public host Caddy serves the API on (docker-compose
  // gives it to caddy; the portal needs the same value for copy-paste).
  const apiBaseUrl = process.env.API_DOMAIN
    ? `https://${process.env.API_DOMAIN}`
    : (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');

  return (
    <KeysManager
      keys={result.keys}
      allowedModels={allowedModels}
      maxKeys={maxKeys}
      role={ctx.role}
      apiBaseUrl={apiBaseUrl}
    />
  );
}
