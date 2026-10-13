import type { Metadata } from "next";
import { randomUUID, timingSafeEqual } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { AuthShell } from "@/components/auth/auth-shell";
import { DevPayForm } from "@/components/billing/dev-pay-form";
import { db } from "@/db";
import { plans, subscriptions } from "@/db/schema";
import { AuthzError, requireActiveOrg } from "@/lib/auth/authorize";
import { billingProvider } from "@/lib/billing/index";
import { devSignBody } from "@/lib/billing/dev";
import { centsUsd } from "@/lib/dashboard/format";
import { log } from "@/lib/log";

export const metadata: Metadata = { title: "Complete payment" };
export const dynamic = "force-dynamic";

/**
 * /billing/confirm — the missing page `devCheckoutUrl()` points at.
 *
 * `DevBillingProvider.begin()` has always returned this URL; until now it
 * 404'd, which meant that with the default `BILLING_PROVIDER=dev` a
 * customer could start checkout and never finish it. Only
 * `scripts/verify-metering.ts`, which signs the callback itself, could
 * reach an activation.
 *
 * The `sig` query parameter is `HMAC-SHA256(subscriptionId)`. It is NOT
 * what authorises the payment — the session and the org-ownership check in
 * the action are. It exists so a hand-edited URL for a subscription that
 * was never handed out fails at the door instead of rendering a page it
 * has no business showing.
 */
function sigMatches(subscriptionId: string, provided: string): boolean {
  try {
    const expected = Buffer.from(devSignBody(subscriptionId), "utf8");
    const actual = Buffer.from(provided, "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    // devSignBody throws when BILLING_DEV_SECRET is missing or too short.
    // An unverifiable signature is a refused one, not a pass.
    return false;
  }
}

/** Same-site relative paths only — this is a post-payment destination. */
function safeReturnPath(raw: string | undefined): string {
  if (!raw) return "/dashboard/billing";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard/billing";
  return raw;
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function DevCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subscriptionId = one(params.subscription);
  const sig = one(params.sig);
  const returnTo = safeReturnPath(one(params.return));

  // The simulator must not exist on a deployment that takes real money.
  if (billingProvider.name !== "dev") {
    return (
      <AuthShell
        title="Not available"
        subtitle="The test payment simulator is not enabled on this deployment."
        footer={<Link href="/dashboard/billing">Back to billing</Link>}
      >
        <p className="text-sm text-gray-600">
          Choose a payment method on the billing page instead.
        </p>
      </AuthShell>
    );
  }

  if (!subscriptionId || !sig || !sigMatches(subscriptionId, sig)) {
    return (
      <AuthShell
        title="This payment link is not valid"
        subtitle="It may have been edited, or it was issued for a different subscription."
        footer={<Link href="/dashboard/billing">Back to billing</Link>}
      >
        <p className="text-sm text-gray-600">
          Start again from your billing page to get a fresh checkout link.
        </p>
      </AuthShell>
    );
  }

  // Anonymous visitors cannot own a subscription, so this is also the
  // sign-in gate for the page. A non-member gets the same 404 as a
  // subscription that does not exist.
  let ctx: Awaited<ReturnType<typeof requireActiveOrg>>;
  try {
    ctx = await requireActiveOrg();
  } catch (e) {
    if (e instanceof AuthzError && e.code === "unauthorized") {
      redirect(`/sign-in?callbackUrl=${encodeURIComponent(`/billing/confirm?${new URLSearchParams({ subscription: subscriptionId, sig, return: returnTo })}`)}`);
    }
    redirect("/dashboard/billing");
  }

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  if (!sub || sub.organizationId !== ctx.orgId) {
    return (
      <AuthShell
        title="That subscription could not be found"
        footer={<Link href="/dashboard/billing">Back to billing</Link>}
      >
        <p className="text-sm text-gray-600">
          If this keeps happening, the link may belong to another account.
        </p>
      </AuthShell>
    );
  }

  const plan = sub ? await db.query.plans.findFirst({ where: eq(plans.id, sub.planId) }) : null;
  if (!plan) {
    return (
      <AuthShell
        title="The plan for this subscription is missing"
        footer={<Link href="/dashboard/billing">Back to billing</Link>}
      >
        <p className="text-sm text-gray-600">
          Nothing has been charged. Please contact support.
        </p>
      </AuthShell>
    );
  }

  if (sub.status === "active") {
    return (
      <AuthShell
        title="This subscription is already active"
        subtitle={`${plan.name} is live — your API keys are unlocked.`}
        footer={<Link href="/dashboard/billing">Go to billing</Link>}
      >
        <p className="text-sm text-gray-600">
          Nothing further to pay. The simulation is idempotent, so paying
          twice cannot double-charge or double-activate.
        </p>
      </AuthShell>
    );
  }

  // One nonce per rendered page. Two clicks post the same value and the
  // second activation is deduped; a later re-subscription renders a fresh
  // page and gets a fresh nonce, so it is not deduped against this one.
  const nonce = randomUUID();

  log.info("dev checkout: simulator page rendered", {
    subscriptionId: sub.id,
    organizationId: ctx.orgId,
    plan: plan.code,
  });

  return (
    <AuthShell
      title="Simulated payment"
      subtitle="No money moves here. This is the local test provider."
      footer={
        <>
          Changed your mind?{" "}
          <Link href="/dashboard/billing" className="text-black underline-offset-4 hover:underline">
            Back to billing
          </Link>
        </>
      }
    >
      <div className="grid gap-5">
        <dl className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-gray-600">Plan</dt>
            <dd className="font-medium text-black">{plan.name}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-gray-600">Amount</dt>
            <dd className="font-medium text-black tabular-nums">{centsUsd(plan.priceCents)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-gray-600">Reference</dt>
            <dd className="truncate font-mono text-xs text-gray-600">dev-{sub.id}</dd>
          </div>
        </dl>

        <p className="text-sm text-gray-600">
          Confirming posts a signed activation to{" "}
          <code className="rounded bg-gray-100 px-1 font-mono text-xs">/api/billing/callback</code>{" "}
          — the same webhook route a real provider would call. Signature
          verification, event deduplication, and the entitlement push to
          the gateway all run for real; only the money is simulated.
        </p>

        <DevPayForm
          subscriptionId={sub.id}
          nonce={nonce}
          returnTo={returnTo}
          amountLabel={centsUsd(plan.priceCents)}
        />
      </div>
    </AuthShell>
  );
}