"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { AuthField } from "@/components/auth/auth-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t17, type D17Lang } from "@/lib/i18n/d17";

/**
 * D17 proof submission — the form half of `submitD17Proof`.
 *
 * WHY A CLIENT FETCH AND NOT A SERVER ACTION. The original was a
 * `'use server'` form bridge, and it was deleted with the rest of the old
 * frontend — taking the only customer path into `d17-proof.ts` with it.
 * This posts to `POST /api/checkout/d17/proof` instead, which keeps the
 * whole customer surface on HTTP JSON like the rest of the API, and makes
 * the rule set exercisable without a browser.
 *
 * The amount is not in this form and never was: `submitD17Proof` reads it
 * from the payment row the checkout created. There is deliberately nothing
 * to tamper with.
 *
 * Accessibility follows the auth forms already in the app: a native
 * `<form>` so Enter submits, `AuthField` for the two text inputs (real
 * `<label>`, `aria-invalid`, `aria-describedby`, `role="alert"`), an
 * explicit confirmation checkbox, and a disabled-while-pending submit.
 */
export function D17ProofForm({
  subscriptionId,
  lang,
  disabled = false,
}: {
  subscriptionId: string;
  lang: D17Lang;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const t = React.useCallback(
    (key: string) => t17(lang, key),
    [lang],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;

    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout/d17/proof", {
        method: "POST",
        body: new FormData(form),
      });

      if (res.ok) {
        // The page re-renders from the database: status moves to
        // proof_submitted, so the waiting state is never a guess about
        // what the server stored.
        formRef.current?.reset();
        setConfirmed(false);
        router.refresh();
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? t("d17.err_generic"));
    } catch {
      setError(t("d17.err_generic"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-5" noValidate>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="lang" value={lang} />

      <AuthField
        id="d17-auth"
        name="authorizationNumber"
        label={t("d17.field_auth")}
        type="text"
        autoComplete="off"
        describedBy="d17-auth-hint"
      />
      <p id="d17-auth-hint" className="-mt-3 text-xs text-gray-600">
        {t("d17.field_auth_hint")}
      </p>

      <AuthField
        id="d17-phone"
        name="senderPhone"
        label={t("d17.field_phone")}
        type="tel"
        autoComplete="tel"
        describedBy="d17-phone-hint"
      />
      <p id="d17-phone-hint" className="-mt-3 text-xs text-gray-600">
        {t("d17.field_phone_hint")}
      </p>

      <div className="grid gap-2">
        <Label htmlFor="d17-screenshot">{t("d17.field_screenshot")}</Label>
        <Input
          id="d17-screenshot"
          name="screenshot"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-describedby="d17-screenshot-hint"
        />
        <p id="d17-screenshot-hint" className="text-xs text-gray-600">
          {t("d17.field_screenshot_hint")}
        </p>
      </div>

      <div className="flex items-start gap-3">
        <input
          id="d17-confirm"
          name="confirm"
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded border-gray-300 accent-black"
        />
        <Label
          htmlFor="d17-confirm"
          className="font-normal leading-snug text-gray-700"
        >
          {t("d17.field_confirm")}
        </Label>
      </div>

      {error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      {/*
        NOT AuthSubmitButton: that component reads useFormStatus, which
        only reflects a server-action form. This one fetches over HTTP, so
        the pending state is local and the button is driven from it —
        otherwise a second submit could land while the first is in flight
        and burn one of the customer's five hourly proof attempts.
      */}
      <div className="grid gap-2">
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending || undefined}>
          {pending ? t("d17.submitting") : t("d17.submit")}
        </Button>
        <p className="text-center text-xs text-gray-500">
          {t("d17.no_pin_notice")}
        </p>
      </div>
    </form>
  );
}