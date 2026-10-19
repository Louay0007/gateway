import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ShieldCheck, ArrowLeft } from "lucide-react";

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
import Logo from "@/assets/logo/logo";

export const metadata: Metadata = { title: "Pay with D17" };
export const dynamic = "force-dynamic";

/**
 * /checkout/d17/[subscriptionId] — professional subscription checkout.
 *
 * Wide two-column layout: instructions on the left, proof form on the right.
 * Stepper at top shows progress through Transfer → Proof → Verification.
 * All monetary values displayed in TND.
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
      <CheckoutShell lang={lang} dir={dir}>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg font-medium text-gray-900">{t("d17.err_generic")}</p>
          <p className="mt-2 text-sm text-gray-500">{t("d17.summary_reference")}: {subscriptionId}</p>
          <Link href="/dashboard/billing" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-black underline-offset-4 hover:underline">
            <ArrowLeft className="size-4" />
            {t("d17.back_dashboard")}
          </Link>
        </div>
      </CheckoutShell>
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
  //
  // Keyed on the SUBSCRIPTION, not the payment row. `payment.status` lags:
  // approval flips the subscription to `active` inside applyCallback() and
  // only afterwards writes `status = 'paid'` on the row, so for a moment —
  // and indefinitely if that write fails — a genuinely subscribed customer
  // is still `proof_submitted` and would be shown the proof form again,
  // invited to pay twice for a plan they already own.
  //
  // Access is gated by the entitlement, not by this row, so the
  // subscription is the only honest signal that the plan is live.
  if (sub.status === "active") {
    const paidAt = payment?.verifiedAt ? new Date(payment.verifiedAt) : null;
    return (
      <CheckoutShell lang={lang} dir={dir}>
        <div className="mx-auto max-w-lg py-10 text-center">
          <D17StatusCard status="paid" lang={lang} className="mb-6" />
          <p className="text-sm leading-relaxed text-gray-600">
            {t("d17.email_approved_body", {
              plan: plan?.name ?? "",
              amount: payment ? formatTndMillimes(payment.amountMillimes) : "",
            })}
          </p>
          {paidAt ? (
            <p className="mt-2 text-xs text-gray-400">
              {paidAt.toLocaleString(lang === "fr" ? "fr-TN" : "en-US", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
              })}{" "}
              UTC
            </p>
          ) : null}
          {/* To BILLING, and carrying ?state=active — that query param is the
              only thing that lights the dashboard's "Payment received" banner.
              The dev provider set it; the real D17 flow never did, so a
              customer paying by bank transfer finished checkout and landed on
              a page that said nothing about their payment having worked. */}
          <Link
            href="/dashboard/billing?state=active"
            className="mt-8 inline-flex items-center justify-center rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            {t("d17.back_dashboard")}
          </Link>
        </div>
      </CheckoutShell>
    );
  }

  // ── No payment row ───────────────────────────────────────────────────
  if (!payment) {
    return (
      <CheckoutShell lang={lang} dir={dir}>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg font-medium text-gray-900">{t("d17.err_generic")}</p>
          <p className="mt-2 text-sm text-gray-500">{t("d17.summary_reference")}: {subscriptionId}</p>
          <Link href="/dashboard/billing" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-black underline-offset-4 hover:underline">
            <ArrowLeft className="size-4" />
            {t("d17.back_dashboard")}
          </Link>
        </div>
      </CheckoutShell>
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

  const isActionable = status === "pending_payment" || status === "rejected";

  return (
    <CheckoutShell lang={lang} dir={dir}>
      <div className="mx-auto w-full max-w-4xl">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-black sm:text-3xl">
            {plan?.name ?? "Subscription"}
          </h1>
          <p className="mt-2 flex items-center justify-center gap-2 text-sm text-gray-500">
            <span className="font-mono font-medium text-black">{formatTndMillimes(payment.amountMillimes)}</span>
            <span aria-hidden className="text-gray-300">·</span>
            <span>{t(statusKey[status] ?? "d17.status_pending")}</span>
          </p>
        </header>

        {/* ── Progress Stepper ────────────────────────────────────────── */}
        <nav aria-label={t("d17.step_transfer")} className="mb-10 px-2">
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

        {/* ── Status Card ─────────────────────────────────────────────── */}
        {status !== 'pending_payment' && (
          <div className="mb-8">
            <D17StatusCard
              status={status}
              lang={lang}
              rejectReason={payment.rejectReason}
              flaggedReview={payment.flaggedReview}
            />
          </div>
        )}

        {/* ── Main Content Grid ───────────────────────────────────────── */}
        {isActionable && phone ? (
          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            {/* Left column: Instructions + Summary */}
            <div className="space-y-6">
              {/* Payment Summary Card */}
              <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 bg-gray-50/50 px-5 py-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t("d17.summary_reference")}</h2>
                </div>
                <dl className="divide-y divide-gray-50 px-5">
                  <SummaryRow label={t("d17.summary_plan")} value={plan?.name ?? "—"} />
                  <SummaryRow label={t("d17.summary_amount")} value={formatTndMillimes(payment.amountMillimes)} mono highlight />
                  <SummaryRow label={t("d17.summary_reference")} value={`d17-${payment.id.slice(0, 8)}`} mono small />
                  <SummaryRow label={t("d17.summary_status")} value={t(statusKey[payment.status] ?? "d17.status_pending")} />
                </dl>
              </section>

              {/* Transfer Instructions */}
              {!rejected && (
                <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-5">
                    <h2 className="text-base font-semibold text-black">{t("d17.step_transfer")}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">{t("d17.method_hint")}</p>
                  </div>
                  <D17Instructions
                    lang={lang}
                    amountMillimes={payment.amountMillimes}
                    receiverPhone={phone}
                    reference={`d17-${payment.id}`}
                  />
                  <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
                    <p className="text-sm leading-relaxed text-amber-900">
                      {t("d17.notice", { hours: String(hours) })}
                    </p>
                  </div>
                </section>
              )}
            </div>

            {/* Right column: Proof Form */}
            <aside className="lg:sticky lg:top-8 lg:self-start">
              <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-black">{t("d17.proof_title")}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{t("d17.proof_subtitle")}</p>
                </div>
                <D17ProofForm subscriptionId={subscriptionId} lang={lang} />
              </section>
            </aside>
          </div>
        ) : null}

        {/* ── Waiting state (proof submitted) ─────────────────────────── */}
        {status === "proof_submitted" && (
          <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-gray-50/50 p-8 text-center">
            <p className="text-sm font-medium text-gray-900">{t("d17.waiting_title")}</p>
            <p className="mt-2 text-xs leading-relaxed text-gray-500">{t("d17.waiting_subtitle")}</p>
          </div>
        )}

        {/* ── Expired state ───────────────────────────────────────────── */}
        {status === "expired" && (
          <div className="flex justify-center pt-4">
            <Link
              href="/dashboard/billing"
              className="inline-flex items-center justify-center rounded-lg bg-black px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
            >
              {t("d17.continue")}
            </Link>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer className="mt-12 flex flex-col items-center gap-4 border-t border-gray-100 pt-8">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <ShieldCheck className="size-3.5" aria-hidden />
            <span>{t("d17.no_pin_notice")}</span>
          </div>
          <LangSwitch links={langLinks(base)} />
          <Link href="/dashboard/billing" className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 underline-offset-4 hover:text-black hover:underline">
            <ArrowLeft className="size-3" />
            {t("d17.back_dashboard")}
          </Link>
        </footer>
      </div>
    </CheckoutShell>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function CheckoutShell({
  children,
  lang,
  dir,
}: {
  children: React.ReactNode;
  lang: string;
  dir: "ltr" | "rtl";
}) {
  return (
    <main className="light-surface min-h-dvh bg-white" lang={lang} dir={dir}>
      <div className="animate-hero-rise px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <Link
          href="/"
          aria-label="Zaino AI home"
          className="mb-10 flex justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
        >
          <Logo tone="light" />
        </Link>
        {children}
      </div>
    </main>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  highlight,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd
        className={`text-right ${
          highlight
            ? "text-base font-semibold text-black"
            : small
              ? "text-xs text-gray-600"
              : "text-sm font-medium text-black"
        } ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function LangSwitch({
  links,
}: {
  links: { lang: string; href: string; current: boolean }[];
}) {
  return (
    <nav aria-label="Language" className="flex items-center gap-2">
      {links.map((l) => (
        <Link
          key={l.lang}
          href={l.href}
          hrefLang={l.lang}
          aria-current={l.current ? "true" : undefined}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            l.current
              ? "border border-gray-200 bg-gray-100 text-black"
              : "text-gray-500 hover:text-black"
          }`}
        >
          {l.lang.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}