import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { AuthShell } from "@/components/auth/auth-shell";
import { D17Instructions } from "@/components/d17/d17-instructions";
import { D17ProofForm } from "@/components/d17/d17-proof-form";
import { D17StatusCard, type D17PaymentStatus } from "@/components/d17/d17-status-card";
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
 * /checkout/d17/[subscriptionId] — professional subscription flow with
 * visual progress stepper and state-aware rendering.
 *
 * The stepper shows three stages: Transfer → Proof → Verification.
 * Each payment status maps to a stepper position and a status card
 * that explains what the user should do next.
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

  // ── Already activated ────────────────────────────────────────────────
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
        <D17StatusCard status="paid" lang={lang} className="mb-6" />
        <div dir={dir} className="grid gap-4" />
      </AuthShell>
    );
  }

  // ── No payment row ───────────────────────────────────────────────────
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
        <p className="text-sm text-gray-600">{t("d17.summary_reference")}: {subscriptionId}</p>
      </AuthShell>
    );
  }

  // ── Stepper state derivation ─────────────────────────────────────────
  const status = payment.status as D17PaymentStatus;
  const stepperStep =
    status === "paid" ? 3 :
    status === "proof_submitted" ? 2 :
    status === "rejected" ? 1 :
    status === "expired" ? 0 :
    0; // pending_payment

  const phone = d17ReceiverPhone();
  const hours = Math.max(1, Math.round(reviewWindowMinutes() / 60));
  const rejected = status === "rejected";
  const base = `/checkout/d17/${subscriptionId}`;

  const statusKey: Record<string, string> = {
    pending_payment: "d17.status_pending",
    proof_submitted: "d17.status_submitted",
    paid: "d17.status_paid",
    rejected: "d17.status_rejected",
    expired: "d17.status_expired",
  };

  return (
    <AuthShell
      title={plan?.name ?? "Subscription"}
      subtitle={
        <span className="flex items-center gap-2 text-sm font-normal text-gray-500">
          <span>{formatTndMillimes(payment.amountMillimes)}</span>
          <span aria-hidden>·</span>
          <span>{t(statusKey[status] ?? "d17.status_pending")}</span>
        </span>
      }
      footer={
        <Link href="/dashboard/billing" className="text-black underline-offset-4 hover:underline">
          {t("d17.back_dashboard")}
        </Link>
      }
    >
      <div dir={dir} className="grid gap-8">
        {/* ── Progress Stepper ─────────────────────────────────────── */}
        <nav aria-label={t("d17.step_transfer")} className="px-1">
          <ol className="flex items-center justify-between">
            {[
              { key: "d17.step_transfer", step: 0 },
              { key: "d17.step_proof", step: 1 },
              { key: "d17.step_verify", step: 2 },
            ].map(({ key, step }) => {
              const state =
                step < stepperStep ? "completed" :
                step === stepperStep ? "active" :
                "upcoming";
              return (
                <li key={key} className="d17-stepper-step" data-state={state}>
                  <div className="d17-stepper-circle" data-state={state} aria-current={state === "active" ? "step" : undefined}>
                    {state === "completed" ? "✓" : step + 1}
                  </div>
                  <span className={`text-[11px] font-medium tracking-wide uppercase ${state === "active" ? "text-black" : "text-muted-foreground"}`}>
                    {t(key)}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ── Status Card ──────────────────────────────────────────── */}
        {/* Only show after proof submission or admin action. A fresh
         * pending_payment row means the customer hasn't transferred yet;
         * showing "awaiting verification" at that point is misleading —
         * the instructions and form below already tell them what to do. */}
        {status !== 'pending_payment' && (
          <D17StatusCard
            status={status}
            lang={lang}
            rejectReason={payment.rejectReason}
            flaggedReview={payment.flaggedReview}
          />
        )}

        {/* ── Payment Summary ──────────────────────────────────────── */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t("d17.summary_reference")}</h2>
          </div>
          <dl className="grid gap-y-3 px-5 py-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-gray-500">{t("d17.summary_plan")}</dt>
              <dd className="font-medium text-black">{plan?.name ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-gray-500">{t("d17.summary_amount")}</dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-black">{formatTndMillimes(payment.amountMillimes)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-gray-500">{t("d17.summary_reference")}</dt>
              <dd className="font-mono text-xs text-gray-600">d17-{payment.id.slice(0, 8)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-gray-500">{t("d17.summary_status")}</dt>
              <dd className="font-medium text-black">{t(statusKey[payment.status] ?? "d17.status_pending")}</dd>
            </div>
          </dl>
        </section>

        {/* ── Instructions + Proof Form (only when actionable) ────── */}
        {(status === "pending_payment" || status === "rejected") && phone && (
          <>
            {!rejected && (
              <section className="grid gap-5">
                <div className="grid gap-2">
                  <h2 className="text-sm font-semibold text-black">{t("d17.step_transfer")}</h2>
                  <p className="text-sm leading-relaxed text-gray-600">{t("d17.method_hint")}</p>
                </div>
                <D17Instructions
                  lang={lang}
                  amountMillimes={payment.amountMillimes}
                  receiverPhone={phone}
                  reference={`d17-${payment.id}`}
                />
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm text-amber-900">
                  {t("d17.notice", { hours: String(hours) })}
                </div>
              </section>
            )}

            <section className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="grid gap-1.5">
                <h2 className="text-sm font-semibold text-black">{t("d17.proof_title")}</h2>
                <p className="text-sm leading-relaxed text-gray-600">{t("d17.proof_subtitle")}</p>
              </div>
              <D17ProofForm subscriptionId={subscriptionId} lang={lang} />
            </section>
          </>
        )}

        {/* ── Waiting state (proof submitted) ─────────────────────── */}
        {status === "proof_submitted" && (
          <div className="grid gap-2 rounded-xl border border-gray-200 bg-gray-50/50 p-6 text-center">
            <p className="text-sm font-medium text-gray-900">{t("d17.waiting_title")}</p>
            <p className="text-xs leading-relaxed text-gray-500">{t("d17.waiting_subtitle")}</p>
          </div>
        )}

        {/* ── Expired state ───────────────────────────────────────── */}
        {status === "expired" && (
          <div className="flex justify-center pt-2">
            <Link
              href="/dashboard/billing"
              className="inline-flex items-center justify-center rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
            >
              {t("d17.continue")}
            </Link>
          </div>
        )}

        {/* ── Footer notices ──────────────────────────────────────── */}
        <div className="grid gap-4 border-t border-gray-100 pt-6">
          <p className="text-center text-xs leading-relaxed text-gray-500">{t("d17.no_pin_notice")}</p>
          <LangSwitch links={langLinks(base)} />
        </div>
      </div>
    </AuthShell>
  );
}

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