import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { AuthShell } from "@/components/auth/auth-shell";
import { D17Instructions } from "@/components/d17/d17-instructions";
import { D17ProofForm } from "@/components/d17/d17-proof-form";
import { db } from "@/db";
import { plans, subscriptions } from "@/db/schema";
import { AuthzError, requireActiveOrg } from "@/lib/auth/authorize";
import {
  d17ReceiverPhone,
  formatTndMillimes,
  reviewWindowMinutes,
} from "@/lib/billing/d17-config";
import { loadD17Payment } from "@/lib/billing/d17";
import { D17_LANGS, d17Dir, isD17Lang, t17 } from "@/lib/i18n/d17";

export const metadata: Metadata = { title: "Pay with D17" };
export const dynamic = "force-dynamic";

/**
 * /checkout/d17/[subscriptionId] — the instruction page `d17.ts:begin()`
 * has always returned, and which 404'd because the page was deleted with
 * the old frontend.
 *
 * Without it the manual payment method could not be completed from a
 * browser at all: `lib/billing/d17-proof.ts` had no reachable caller, and
 * no customer could ever hand over an authorization number. The provider
 * writes the payment row and hands back a URL to THIS page — there is
 * nothing on D17's side to redirect to.
 *
 * The page renders one of five states from the payment row's own status,
 * which is the same state `d17-admin.ts` and `expire_subscriptions` move:
 *
 *   pending_payment  → instructions + proof form
 *   proof_submitted  → waiting (nothing to do but wait)
 *   rejected         → reason banner + one resubmission
 *   paid             → done
 *   expired          → window elapsed, start again
 *
 * Authorization: the org comes from the session and the subscription must
 * belong to it. Another account's subscription id answers the same "not
 * found" page as one that does not exist.
 *
 * Language is `?lang=`, defaulting to FR — the documented resolution order
 * in `lib/i18n/d17.ts` is query → cookie → FR, and the cookie is not
 * written here: every language link carries the parameter, which needs no
 * mutation and cannot be used to set a cookie on someone's browser.
 */
export default async function D17CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ subscriptionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { subscriptionId } = await params;
  const query = await searchParams;
  const rawLang = Array.isArray(query.lang) ? query.lang[0] : query.lang;
  const lang = isD17Lang(rawLang) ? rawLang : "fr";
  const dir = d17Dir(lang);
  const t = (key: string, vars?: Record<string, string>) => t17(lang, key, vars);

  let ctx: Awaited<ReturnType<typeof requireActiveOrg>>;
  try {
    ctx = await requireActiveOrg();
  } catch (e) {
    if (e instanceof AuthzError && e.code === "unauthorized") {
      redirect(
        `/sign-in?callbackUrl=${encodeURIComponent(`/checkout/d17/${subscriptionId}`)}`,
      );
    }
    redirect("/dashboard/billing");
  }

  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, subscriptionId),
      eq(subscriptions.organizationId, ctx.orgId),
    ),
  });
  if (!sub) {
    return (
      <AuthShell
        title={t("d17.err_generic")}
        footer={
          <Link href="/dashboard/billing" className="text-black underline-offset-4 hover:underline">
            {t("d17.back_dashboard")}
          </Link>
        }
      >
        <p className="text-sm text-gray-600">{t("d17.summary_reference")}: {subscriptionId}</p>
      </AuthShell>
    );
  }

  const plan = await db.query.plans.findFirst({ where: eq(plans.id, sub.planId) });
  const payment = await loadD17Payment(subscriptionId);

  const langLinks = (base: string) =>
    D17_LANGS.map((l) => ({
      lang: l,
      href: `${base}?lang=${l}`,
      current: l === lang,
    }));

  // ── Already activated: nothing to collect ────────────────────────────
  if (sub.status === "active" && payment?.status === "paid") {
    return (
      <AuthShell
        title={t("d17.status_paid")}
        subtitle={t("d17.email_approved_body", {
          plan: plan?.name ?? "",
          amount: formatTndMillimes(payment.amountMillimes),
        })}
        footer={
          <Link href="/dashboard" className="text-black underline-offset-4 hover:underline">
            {t("d17.back_dashboard")}
          </Link>
        }
      >
        <div dir={dir} className="grid gap-4" />
      </AuthShell>
    );
  }

  // ── No payment row: checkout was never started for this subscription ──
  if (!payment) {
    return (
      <AuthShell
        title={t("d17.err_generic")}
        footer={
          <Link href="/dashboard/billing" className="text-black underline-offset-4 hover:underline">
            {t("d17.back_dashboard")}
          </Link>
        }
      >
        <p className="text-sm text-gray-600">{t("d17.method_hint")}</p>
      </AuthShell>
    );
  }

  const amount = formatTndMillimes(payment.amountMillimes);
  const phone = d17ReceiverPhone();
  const base = `/checkout/d17/${subscriptionId}`;
  const hours = Math.max(1, Math.round(reviewWindowMinutes() / 60));

  const statusKey: Record<string, string> = {
    pending_payment: "d17.status_pending",
    proof_submitted: "d17.status_submitted",
    paid: "d17.status_paid",
    rejected: "d17.status_rejected",
    expired: "d17.status_expired",
  };

  // ── Window elapsed ────────────────────────────────────────────────────
  if (payment.status === "expired" || payment.expiresAt.getTime() < Date.now()) {
    return (
      <AuthShell
        title={t("d17.status_expired")}
        subtitle={t("d17.err_expired")}
        footer={
          <Link href="/dashboard/billing" className="text-black underline-offset-4 hover:underline">
            {t("d17.back_dashboard")}
          </Link>
        }
      >
        <div dir={dir} className="grid gap-4">
          <dl className="grid gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600">{t("d17.summary_amount")}</dt>
              <dd className="font-medium tabular-nums text-black">{amount} DT</dd>
            </div>
          </dl>
          <LangSwitch links={langLinks(base)} />
        </div>
      </AuthShell>
    );
  }

  // ── Proof submitted: the only honest thing to say is "we are checking" ─
  if (payment.status === "proof_submitted") {
    return (
      <AuthShell
        title={t("d17.waiting_title")}
        subtitle={t("d17.waiting_subtitle")}
        footer={
          <Link href="/dashboard" className="text-black underline-offset-4 hover:underline">
            {t("d17.back_dashboard")}
          </Link>
        }
      >
        <div dir={dir} className="grid gap-4">
          <dl className="grid gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600">{t("d17.summary_amount")}</dt>
              <dd className="font-medium tabular-nums text-black">{amount} DT</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600">{t("d17.summary_status")}</dt>
              <dd className="font-medium text-black">{t(statusKey[payment.status]!)}</dd>
            </div>
          </dl>
          <p className="text-sm text-gray-600">{t("d17.waiting_email_note")}</p>
          {payment.flaggedReview ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t("d17.waiting_review")}
            </p>
          ) : null}
          <LangSwitch links={langLinks(base)} />
        </div>
      </AuthShell>
    );
  }

  // ── pending_payment OR rejected: the actionable states ───────────────
  const rejected = payment.status === "rejected";

  return (
    <AuthShell
      className="max-w-xl"
      title={rejected ? t("d17.proof_title") : t("d17.instructions_title")}
      subtitle={rejected ? t("d17.resubmit") : t("d17.instructions_subtitle")}
      footer={
        <Link href="/dashboard" className="text-black underline-offset-4 hover:underline">
          {t("d17.back_dashboard")}
        </Link>
      }
    >
      <div dir={dir} className="grid gap-6">
        <dl className="grid gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-600">{t("d17.summary_amount")}</dt>
            <dd className="font-medium tabular-nums text-black">{amount} DT</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-600">{t("d17.summary_deadline")}</dt>
            <dd className="font-medium text-black">
              {payment.expiresAt.toLocaleString(lang === "ar" ? "ar-TN" : lang === "en" ? "en-GB" : "fr-TN", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
              })}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-600">{t("d17.summary_status")}</dt>
            <dd className="font-medium text-black">{t(statusKey[payment.status] ?? "d17.status_pending")}</dd>
          </div>
        </dl>

        {rejected && payment.rejectReason ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {t("d17.rejected_banner", { reason: payment.rejectReason })}
          </p>
        ) : null}

        {!rejected ? (
          <>
            <p className="text-sm text-gray-600">{t("d17.method_hint")}</p>
            <D17Instructions
              lang={lang}
              amountMillimes={payment.amountMillimes}
              receiverPhone={phone}
              reference={`d17-${payment.id}`}
            />
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {t("d17.notice", { hours: String(hours) })}
            </p>
            <hr className="border-gray-200" />
          </>
        ) : null}

        <section className="grid gap-3">
          <h2 className="text-sm font-semibold text-black">{t("d17.proof_title")}</h2>
          <p className="text-sm text-gray-600">{t("d17.proof_subtitle")}</p>
          <D17ProofForm subscriptionId={subscriptionId} lang={lang} />
        </section>

        <p className="text-xs text-gray-600">{t("d17.no_pin_notice")}</p>
        <LangSwitch links={langLinks(base)} />
      </div>
    </AuthShell>
  );
}

/** Plain links, one per language. `dir` is already set on the container. */
function LangSwitch({
  links,
}: {
  links: { lang: string; href: string; current: boolean }[];
}) {
  return (
    <nav aria-label="Language" className="flex items-center gap-3 text-xs">
      {links.map((l) => (
        <Link
          key={l.lang}
          href={l.href}
          hrefLang={l.lang}
          aria-current={l.current ? "true" : undefined}
          className={
            l.current
              ? "rounded border border-gray-300 bg-gray-100 px-2 py-1 font-medium text-black"
              : "rounded border border-transparent px-2 py-1 text-gray-600 hover:text-black"
          }
        >
          {l.lang.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}