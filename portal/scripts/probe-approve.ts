/**
 * Reproduce the approveD17Payment UNDEFINED_VALUE (D17 admin path).
 *
 * Builds a throwaway org + subscription + payment row in a transaction-like
 * fashion, calls approveD17Payment with the REAL positional signature, and
 * prints exactly where it throws. Every row it creates is deleted at the end.
 *
 * Run from the VPS:
 *   docker compose run --rm --no-deps jobs node --experimental-transform-types \
 *     --import ./scripts/register-ts-resolve.mjs scripts/probe-approve.ts
 */

import './env.mjs';
import { db } from '@/db';
import {
  entitlements,
  organizationMembers,
  organizations,
  paymentsD17,
  plans,
  subscriptions,
  users,
} from '@/db/schema';
import { approveD17Payment } from '@/lib/billing/d17-admin';
import { log } from '@/lib/log';

const stamp = Date.now().toString(36);
const created = { orgId: '', userId: '', subId: '', paymentId: '' };

function cleanup() {
  // payments_d17 and subscriptions cascade from the org.
  void db.delete(entitlements);
  void db.delete(organizations);
  void db.delete(users);
}

async function main() {
  const plan = await db.query.plans.findFirst();
  if (!plan) throw new Error('no plan rows — is the seed loaded?');

  const [org] = await db
    .insert(organizations)
    .values({ name: `probe-org-${stamp}`, slug: `probe-org-${stamp}` })
    .returning({ id: organizations.id });
  created.orgId = org!.id;

  const [user] = await db
    .insert(users)
    .values({
      email: `probe-${stamp}@example.invalid`,
      name: 'Probe',
      authProvider: 'authjs',
      authId: `probe-${stamp}`,
    })
    .returning({ id: users.id });
  created.userId = user!.id;

  await db.insert(organizationMembers).values({
    organizationId: org!.id,
    userId: user!.id,
    role: 'owner',
  });

  // `incomplete` is what d17.begin() leaves behind.
  const [sub] = await db
    .insert(subscriptions)
    .values({
      organizationId: org!.id,
      planId: plan.id,
      status: 'incomplete',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    })
    .returning({ id: subscriptions.id });
  created.subId = sub!.id;

  const [payment] = await db
    .insert(paymentsD17)
    .values({
      subscriptionId: sub!.id,
      organizationId: org!.id,
      amountMillimes: 5000,
      usdAmountCents: 1613,
      fxRate: '3.1',
      authorizationNumber: `PROBE${stamp.toUpperCase()}`,
      senderPhone: '20123456',
      status: 'proof_submitted',
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    })
    .returning({ id: paymentsD17.id });
  created.paymentId = payment!.id;

  console.log(`plan=${plan.code} sub=${sub!.id} payment=${payment!.id}`);

  // The real signature is POSITIONAL: (staffId, paymentId).
  let outcome = 'no-throw';
  try {
    const result = await approveD17Payment(created.userId, created.paymentId);
    outcome = `returned ${JSON.stringify(result)}`;
  } catch (e) {
    outcome = `THREW: ${e instanceof Error ? e.message : String(e)}`;
    console.error('stack:', e instanceof Error ? e.stack : '(none)');
  }
  console.log('approveD17Payment ->', outcome);

  const after = await db.query.paymentsD17.findFirst({
    where: (t, { eq }) => eq(t.id, created.paymentId),
  });
  const subAfter = await db.query.subscriptions.findFirst({
    where: (t, { eq }) => eq(t.id, created.subId),
  });
  console.log('payment.status  =', after?.status);
  console.log('sub.status      =', subAfter?.status);
}

try {
  await main();
} catch (e) {
  console.error('probe failed:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  cleanup();
  // Give the fire-and-forget deletes a beat.
  await new Promise((r) => setTimeout(r, 1500));
  log.info('probe cleanup issued');
}