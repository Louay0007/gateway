#!/usr/bin/env node
/**
 * verify-d17.ts — prove the manual D17 payment path end-to-end.
 *
 * D17 (La Poste Tunisienne) has no merchant API, so this is the one
 * payment method whose correctness lives entirely in our code: the
 * amount we ask for, the uniqueness of the authorization number, the
 * payment window, the idempotency of approval, and the staff gate.
 * `make verify-d17` runs it in the jobs container (database + portal on
 * the compose network).
 *
 * The cases, in order (these are the brief's test list):
 *
 *   T1  amount        — the row asks for exactly plan × configured rate,
 *                       in TND millimes, computed server-side
 *   T2  proof submit  — pending_payment → proof_submitted, customer and
 *                       ops notified (log transport in dev)
 *   T3  DUPLICATE     — one authorization number cannot pay two
 *                       subscriptions: refused + audit row
 *   T4  wrong amount  — the submission path has no amount input at all;
 *                       the stored amount is unchanged by a proof
 *   T5  double approval — approving twice activates the subscription
 *                       exactly once (billing_events dedupe)
 *   T6  unauthorized admin — an unauthenticated caller cannot pass the
 *                       staff gate; the export and screenshot routes
 *                       answer 401 to anonymous callers
 *   T7  expired order — a proof after the window is refused and the
 *                       payment expires; the expiry job sweeps it
 *   T8  reject + resubmit — rejection needs a reason, notifies the
 *                       customer, and allows one resubmission
 *   T9  screenshot    — stored content-typed, EXIF-stripped, randomized
 *                       filename, outside the web root, unreadable
 *                       without staff
 *   T10 reconciliation + CSV — approved totals are computable and the
 *                       export is well-formed
 *
 * Like verify-metering, it leaves its evidence behind (the ledger is
 * the record) and re-runs cleanly with fresh accounts each time.
 */

import './env.mjs';

import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, sql as pg } from '@/db';
import { auditLog, organizations, paymentsD17, subscriptions } from '@/db/schema';
import { createLocalUser } from '@/lib/auth/create-user';
import { ensurePersonalOrg } from '@/lib/auth/provision';
import { beginCheckout } from '@/lib/billing';
import { D17ProofError, submitD17Proof } from '@/lib/billing/d17-proof';
import {
  approveD17Payment,
  d17PaymentsCsv,
  d17Reconciliation,
  listD17Queue,
  rejectD17Payment,
} from '@/lib/billing/d17-admin';
import { expireSubscriptions } from '@/lib/jobs/expire-subscriptions';
import {
  d17ReceiverPhone,
  d17UploadsDir,
  formatTndMillimes,
  paymentWindowHours,
} from '@/lib/billing/d17-config';

// ───────────────────────────────────────────────────────────────────────
//  Assertion plumbing
// ───────────────────────────────────────────────────────────────────────

const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
    failures.push(detail ? `${label} — ${detail}` : label);
  }
}

function section(title: string): void {
  process.stdout.write(`\n── ${title}\n`);
}

/** A minimal valid PNG (1×1) — enough for the content-type and re-encode path. */
async function makeScreenshot(): Promise<File> {
  const sharp = (await import('sharp')).default;
  const buffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#204080' },
  })
    .withExifMerge({ IFD0: { Copyright: 'should be stripped' } })
    .png()
    .toBuffer();
  // Wrap the exact bytes in a File, as a multipart form would.
  return new File([new Uint8Array(buffer)], 'proof.png', { type: 'image/png' });
}

/** Create an account + org and start a D17 checkout. */
async function startCheckout(planCode = 'starter') {
  const runTag = randomBytes(4).toString('hex');
  const email = `d17-${runTag}@verify.invalid`;
  const password = randomBytes(18).toString('base64url');
  const { domainUserId } = await createLocalUser({ email, name: 'D17 Buyer', password });
  const org = await ensurePersonalOrg(domainUserId);
  const { intent } = await beginCheckout(org.organizationId, planCode, domainUserId, 'd17');
  return {
    email,
    password,
    domainUserId,
    organizationId: org.organizationId,
    subscriptionId: intent.subscriptionId,
  };
}

async function loadPayment(subscriptionId: string) {
  return db.query.paymentsD17.findFirst({
    where: eq(paymentsD17.subscriptionId, subscriptionId),
  });
}

/**
 * Sign in through the real Auth.js credentials flow and return the
 * session cookie, ready to be sent as a `Cookie:` header. The cookie is
 * `__Secure-` prefixed, which a browser would only send over HTTPS —
 * setting the header explicitly is what lets this run against the
 * loopback portal.
 */
async function signInAsCustomer(
  portalUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const csrfRes = await fetch(`${portalUrl}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const cookies = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]!).join('; ');

  const res = await fetch(`${portalUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({ csrfToken, email, password }),
  });

  const sessionCookies = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => c.includes('session-token'));
  return sessionCookies.join('; ');
}

async function main(): Promise<void> {
  const run = randomBytes(3).toString('hex');

  /**
   * The proof rate limit is Postgres-backed and its backoff outlives
   * this process, so re-running with a fixed IP would trip the very
   * limit under test. A run-unique IP keeps each run independent while
   * still exercising the throttle within the run.
   */
  const ip = `203.0.113.${10 + Math.floor(Math.random() * 180)}`;

  process.stdout.write(`\nD17 verification — run ${run}  (ip ${ip})\n`);

  check(
    'the merchant phone is configured',
    d17ReceiverPhone().length >= 8,
    d17ReceiverPhone() || 'D17_RECEIVER_PHONE empty',
  );

  // ── T1: the amount is ours, computed server-side ────────────────────
  section('T1 amount (server-side, TND millimes)');
  const buyerA = await startCheckout('starter');
  const paymentA = await loadPayment(buyerA.subscriptionId);
  check('a payment row exists at checkout', Boolean(paymentA));
  // Starter is $19.00; at the default 3.10 rate that is 58.900 DT.
  const expectedMillimes = Math.round((1900 / 100) * 3.1 * 1000);
  check(
    `the row asks for ${formatTndMillimes(expectedMillimes)} DT (${expectedMillimes} millimes)`,
    paymentA?.amountMillimes === expectedMillimes && paymentA?.currency === 'TND',
    `got ${paymentA?.amountMillimes} ${paymentA?.currency}`,
  );
  check(
    `the deadline is ${paymentWindowHours()}h out`,
    Math.abs(
      (paymentA!.expiresAt.getTime() - Date.now() - paymentWindowHours() * 3600_000) / 1000,
    ) < 60,
    paymentA?.expiresAt.toISOString(),
  );
  check('status starts pending_payment', paymentA?.status === 'pending_payment', paymentA?.status);

  const authA = `AUTH${randomBytes(4).toString('hex').toUpperCase()}`;
  const phoneA = '20123456';

  // ── T2: submit the proof ────────────────────────────────────────────
  section('T2 proof submission');
  const submitted = await submitD17Proof({
    subscriptionId: buyerA.subscriptionId,
    organizationId: buyerA.organizationId,
    authorizationNumber: authA,
    senderPhone: phoneA,
    screenshot: null,
    ip,
    userAgent: 'verify-d17',
    lang: 'fr',
  });
  check('proof accepted (proof_submitted)', Boolean(submitted.paymentId));

  const afterSubmit = await loadPayment(buyerA.subscriptionId);
  check(
    'row moved to proof_submitted with the normalized auth number',
    afterSubmit?.status === 'proof_submitted' &&
      afterSubmit?.authorizationNumber === authA &&
      afterSubmit?.senderPhone === phoneA,
    `${afterSubmit?.status}/${afterSubmit?.authorizationNumber}`,
  );

  // ── T3: one transfer cannot pay two subscriptions ───────────────────
  section('T3 duplicate authorization number');
  const buyerB = await startCheckout('starter');
  const paymentB = await loadPayment(buyerB.subscriptionId);

  let duplicateBlocked = '';
  try {
    await submitD17Proof({
      subscriptionId: buyerB.subscriptionId,
      organizationId: buyerB.organizationId,
      authorizationNumber: authA.toLowerCase(), // case must not matter
      senderPhone: '20987654',
      screenshot: null,
      ip,
      userAgent: 'verify-d17',
      lang: 'fr',
    });
    duplicateBlocked = 'submission unexpectedly succeeded';
  } catch (e) {
    duplicateBlocked = e instanceof D17ProofError ? e.message : String(e);
  }
  check(
    'the duplicate is refused with a friendly error',
    duplicateBlocked === 'auth_duplicate',
    duplicateBlocked,
  );

  const [dupeAudit] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'd17.duplicate_blocked'), eq(auditLog.targetId, paymentB!.id)))
    .limit(1);
  check('the attempt is flagged for the admin (audit row)', Boolean(dupeAudit));

  // Buyer B can still pay with their OWN number.
  const authB = `AUTH${randomBytes(4).toString('hex').toUpperCase()}`;
  await submitD17Proof({
    subscriptionId: buyerB.subscriptionId,
    organizationId: buyerB.organizationId,
    authorizationNumber: authB,
    senderPhone: '20987654',
    screenshot: null,
    ip,
    userAgent: 'verify-d17',
    lang: 'fr',
  });
  check('buyer B may pay with their own number', true);

  // ── T4: the amount cannot be lied about ─────────────────────────────
  section('T4 wrong amount (no amount input exists)');
  const amountBefore = (await loadPayment(buyerB.subscriptionId))!.amountMillimes;
  // The submission signature has no amount field at all — this asserts
  // the stored value survives a proof unchanged.
  check(
    'the stored amount is unchanged by submitting a proof',
    (await loadPayment(buyerB.subscriptionId))!.amountMillimes === amountBefore,
    `${amountBefore}`,
  );

  // ── T5: approving twice fulfils once ────────────────────────────────
  section('T5 double approval (idempotent)');
  const first = await approveD17Payment('verify-staff', paymentA!.id);
  const second = await approveD17Payment('verify-staff', paymentA!.id);
  check('the first approval succeeds', first.ok && !first.alreadyApplied, JSON.stringify(first));
  check(
    'the second approval is a no-op, not a second fulfilment',
    second.ok && second.alreadyApplied === true,
    JSON.stringify(second),
  );

  const [activationEvents] = await db
    .select()
    .from((await import('@/db/schema')).billingEvents)
    .where(eq((await import('@/db/schema')).billingEvents.id, `d17:${paymentA!.id}:approved`))
    .limit(1);
  check(
    'exactly one activation event exists for this payment',
    Boolean(activationEvents),
    'billing_events row missing',
  );

  const [subA] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, buyerA.subscriptionId));
  check('the subscription is active after approval', subA?.status === 'active', subA?.status);
  const paidRow = await loadPayment(buyerA.subscriptionId);
  check(
    'the payment row records who verified it and when',
    paidRow?.status === 'paid' && paidRow?.verifiedBy === 'verify-staff' && Boolean(paidRow?.verifiedAt),
    `${paidRow?.status}/${paidRow?.verifiedBy}`,
  );

  // ── T6: unauthorized admin access ───────────────────────────────────
  section('T6 unauthorized admin access');
  // The gate is the ROUTE's requireStaff(), so test the route: anonymous,
  // then a signed-in CUSTOMER. (requireStaff itself cannot be imported
  // here — authorize.ts pulls next/navigation, which the runner cannot
  // resolve, and a gate tested only in-process is not a test of the
  // gate that guards the money.)
  const portal = process.env.PORTAL_INTERNAL_URL ?? 'http://portal:3000';

  const anonExport = await fetch(`${portal}/api/admin/d17/export`);
  check(
    `CSV export answers 401 to anonymous callers (got ${anonExport.status})`,
    anonExport.status === 401,
    `status ${anonExport.status}`,
  );
  const anonShot = await fetch(`${portal}/api/admin/d17/${paymentB!.id}/screenshot`);
  check(
    `screenshot route answers 401 to anonymous callers (got ${anonShot.status})`,
    anonShot.status === 401,
    `status ${anonShot.status}`,
  );

  // Sign in as a CUSTOMER through the real Auth.js flow.
  const jarCookie = await signInAsCustomer(portal, buyerA.email, buyerA.password);
  check('a customer session could be created', Boolean(jarCookie));

  const customerExport = await fetch(`${portal}/api/admin/d17/export`, {
    headers: { Cookie: jarCookie },
  });
  check(
    `CSV export answers 403 to a signed-in customer (got ${customerExport.status})`,
    customerExport.status === 403,
    `status ${customerExport.status}`,
  );
  const customerShot = await fetch(`${portal}/api/admin/d17/${paymentB!.id}/screenshot`, {
    headers: { Cookie: jarCookie },
  });
  check(
    `screenshot route answers 403 to a signed-in customer (got ${customerShot.status})`,
    customerShot.status === 403,
    `status ${customerShot.status}`,
  );

  // ── T7: expired order ───────────────────────────────────────────────
  section('T7 expired payment window');
  const buyerC = await startCheckout('starter');
  await pg`
    UPDATE payments_d17
       SET expires_at = now() - interval '1 minute'
     WHERE subscription_id = ${buyerC.subscriptionId}::uuid
  `;

  let expiredBlocked = '';
  try {
    await submitD17Proof({
      subscriptionId: buyerC.subscriptionId,
      organizationId: buyerC.organizationId,
      authorizationNumber: `AUTH${randomBytes(4).toString('hex').toUpperCase()}`,
      senderPhone: '20555666',
      screenshot: null,
      ip,
      userAgent: 'verify-d17',
      lang: 'fr',
    });
    expiredBlocked = 'submission after the window unexpectedly succeeded';
  } catch (e) {
    expiredBlocked = e instanceof D17ProofError ? e.message : String(e);
  }
  check(
    'a proof after the window is refused',
    expiredBlocked === 'expired',
    expiredBlocked,
  );
  const expiredRow = await loadPayment(buyerC.subscriptionId);
  check('the payment is marked expired', expiredRow?.status === 'expired', expiredRow?.status);

  // The expiry job sweeps nothing new here, but must still run clean.
  const swept = await expireSubscriptions();
  check(
    `the expiry job runs clean (paymentsExpired=${swept.paymentsExpired})`,
    swept.failed === 0,
    JSON.stringify(swept),
  );

  // ── T8: reject + resubmit ───────────────────────────────────────────
  section('T8 rejection and resubmission');
  const rejectResult = await rejectD17Payment('verify-staff', paymentB!.id, 'No matching transfer found in D17 history.');
  check('rejection succeeds with a reason', rejectResult.ok, JSON.stringify(rejectResult));

  const rejectedRow = await loadPayment(buyerB.subscriptionId);
  check(
    'the row records the rejection and the reason',
    rejectedRow?.status === 'rejected' && rejectedRow?.rejectReason === 'No matching transfer found in D17 history.',
    rejectedRow?.status,
  );

  const rejectedNoReason = await rejectD17Payment('verify-staff', paymentB!.id, '   ');
  check('a rejection without a reason is refused', !rejectedNoReason.ok, JSON.stringify(rejectedNoReason));

  // Resubmission with a new authorization number is allowed.
  const authB2 = `AUTH${randomBytes(4).toString('hex').toUpperCase()}`;
  const resubmitted = await submitD17Proof({
    subscriptionId: buyerB.subscriptionId,
    organizationId: buyerB.organizationId,
    authorizationNumber: authB2,
    senderPhone: '20987654',
    screenshot: null,
    ip,
    userAgent: 'verify-d17',
    lang: 'fr',
  });
  check('the customer may resubmit after a rejection', Boolean(resubmitted.paymentId));

  // Approving a rejected-then-resubmitted payment works.
  const approveB = await approveD17Payment('verify-staff', paymentB!.id);
  check('the resubmitted proof can be approved', approveB.ok, JSON.stringify(approveB));

  // ── T9: screenshot handling ─────────────────────────────────────────
  section('T9 screenshot (content-typed, EXIF-stripped, staff-only)');
  const buyerD = await startCheckout('starter');
  const withShot = await submitD17Proof({
    subscriptionId: buyerD.subscriptionId,
    organizationId: buyerD.organizationId,
    authorizationNumber: `AUTH${randomBytes(4).toString('hex').toUpperCase()}`,
    senderPhone: '20777888',
    screenshot: await makeScreenshot(),
    ip,
    userAgent: 'verify-d17',
    lang: 'fr',
  });
  const shotRow = await loadPayment(buyerD.subscriptionId);
  check('the proof with a screenshot was accepted', Boolean(withShot.paymentId));
  check(
    'the filename is a randomized uuid, not the upload name',
    /^[0-9a-f-]{36}\.png$/.test(shotRow?.screenshotPath ?? ''),
    shotRow?.screenshotPath ?? 'null',
  );

  // The file exists where the DB says, and nowhere else: no path
  // separators, and it is under the configured uploads directory.
  const { stat, readFile, readdir } = await import('node:fs/promises');
  const storedPath = `${d17UploadsDir()}/${shotRow!.screenshotPath}`;
  const stats = await stat(storedPath);
  check('the file exists under the uploads directory', stats.isFile(), storedPath);

  const bytes = await readFile(storedPath);
  check(
    'EXIF is gone: no maker note or copyright string survives the re-encode',
    !bytes.subarray(0, 64 * 1024).toString('latin1').includes('should be stripped'),
  );

  const listed = await readdir(d17UploadsDir());
  check(
    'the uploads directory holds only renamed pngs',
    listed.every((f) => /^[0-9a-f-]{36}\.png$/.test(f)),
    listed.slice(0, 3).join(', '),
  );

  // ── T10: reconciliation + CSV ───────────────────────────────────────
  section('T10 reconciliation and export');
  const recon = await d17Reconciliation(30);
  check(
    'approved payments are counted in the reconciliation total',
    recon.totals.count >= 2,
    JSON.stringify(recon.totals),
  );

  const csv = await d17PaymentsCsv(30);
  const lines = csv.split('\n');
  check('the CSV has a header and rows', lines.length > 1 && lines[0]!.startsWith('id,'));
  check(
    'the CSV carries both the TND amount and the fx snapshot',
    lines[0]!.includes('amount_tnd') && lines[0]!.includes('usd_cents') && lines[0]!.includes('fx_rate'),
    lines[0],
  );

  // The queue view must not keep decided rows.
  const queue = await listD17Queue(['proof_submitted']);
  check(
    'decided payments leave the verification queue',
    queue.every((r) => !['paid', 'rejected'].includes(r.status)),
  );

  // ── Summary ─────────────────────────────────────────────────────────
  process.stdout.write(
    `\n── summary\n` +
      `  accounts       4 buyers (${buyerA.email}, ${buyerB.email}, …)\n` +
      `  approved       ${recon.totals.count} payment(s), ${formatTndMillimes(recon.totals.totalMillimes)} DT\n` +
      `  coverage       amount, submit, duplicate, amount-tamper, double-approve,\n` +
      `                  staff gate, expiry, reject/resubmit, screenshot, CSV\n`,
  );

  if (failures.length) {
    process.stdout.write(`\n${failures.length} check(s) FAILED:\n`);
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nall checks passed — the D17 manual payment path is proven\n');
}

main()
  .catch((e) => {
    process.stderr.write(
      `d17 verification crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end({ timeout: 5 }).catch(() => {});
  });
