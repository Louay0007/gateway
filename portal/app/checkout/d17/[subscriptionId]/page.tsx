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
      <div dir={dir} className="grid gap-6">
        {/* ── Progress Stepper ─────────────────────────────────────── */}
        <nav aria-label={t("d17.step_transfer")} className="px-2">
          <ol className="flex items-center justify-between">
            {[
              { key: "d17.step_transfer", step: 0 },
              { key: "d17.step_proof", step: 1 },
              { key: "d17.step_verify", step: 2 },
            ].map(({ key, step }, i, arr) => {
              const state =
                step < stepperStep ? "completed" :
                step === stepperStep ? "active" :
                "upcoming";
              return (
                <li key={key} className="d17-stepper-step" data-state={state}>
                  <div className="d17-stepper-circle" data-state={state} aria-current={state === "active" ? "step" : undefined}>
                    {state === "completed" ? "✓" : step + 1}
                  </div>
                  <span className={`text-xs font-medium ${state === "active" ? "text-black" : "text-muted-foreground"}`}>
                    {t(key)}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ── Status Card ──────────────────────────────────────────── */}
        <D17StatusCard
          status={status}
          lang={lang}
          rejectReason={payment.rejectReason}
          flaggedReview={payment.flaggedReview}
        />

        {/* ── Payment Summary ──────────────────────────────────────── */}
        <dl className="grid gap-2 rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-600">{t("d17.summary_plan")}</dt>
            <dd className="font-medium text-black">{plan?.name ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-600">{t("d17.summary_amount")}</dt>
            <dd className="font-mono font-medium text-black">{formatTndMillimes(payment.amountMillimes)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-600">{t("d17.summary_reference")}</dt>
            <dd className="font-mono text-gray-700">d17-{payment.id.slice(0, 8)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-600">{t("d17.summary_status")}</dt>
            <dd className="font-medium text-black">{t(statusKey[payment.status] ?? "d17.status_pending")}</dd>
          </div>
        </dl>

        {/* ── Instructions + Proof Form (only when actionable) ────── */}
        {(status === "pending_payment" || status === "rejected") && phone && (
          <>
            {!rejected && (
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
            )}

            <section className="grid gap-3">
              <h2 className="text-sm font-semibold text-black">{t("d17.proof_title")}</h2>
              <p className="text-sm text-gray-600">{t("d17.proof_subtitle")}</p>
              <D17ProofForm subscriptionId={subscriptionId} lang={lang} />
            </section>
          </>
        )}

        {/* ── Waiting state (proof submitted) ─────────────────────── */}
        {status === "proof_submitted" && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
            <p className="text-sm text-gray-700">{t("d17.waiting_title")}</p>
            <p className="mt-1 text-xs text-gray-500">{t("d17.waiting_subtitle")}</p>
          </div>
        )}

        {/* ── Expired state ───────────────────────────────────────── */}
        {status === "expired" && (
          <div className="text-center">
            <Link
              href="/dashboard/billing"
              className="inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              {t("d17.continue")}
            </Link>
          </div>
        )}

        <p className="text-xs text-gray-600">{t("d17.no_pin_notice")}</p>
        <LangSwitch links={langLinks(base)} />
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