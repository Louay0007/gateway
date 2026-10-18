"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { AuthField } from "@/components/auth/auth-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t17, type D17Lang } from "@/lib/i18n/d17";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

/**
 * D17 proof submission — upgraded with inline validation and visual feedback.
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
 * Inline validation catches format errors before they hit the server,
 * reducing round-trips and giving immediate feedback. Server-side
 * validation remains authoritative — this is UX polish, not security.
 */

interface FieldErrors {
  authorizationNumber?: string;
  senderPhone?: string;
  screenshot?: string;
  confirm?: string;
}

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
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [success, setSuccess] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const t = React.useCallback(
    (key: string) => t17(lang, key),
    [lang],
  );

  /** Client-side validation before submit. Catches obvious format issues
   *  so the user doesn't wait for a server round-trip on a typo. */
  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const form = formRef.current;
    if (!form) return errors;

    const auth = form.elements.namedItem("authorizationNumber") as HTMLInputElement | null;
    const phone = form.elements.namedItem("senderPhone") as HTMLInputElement | null;

    if (!auth?.value.trim()) {
      errors.authorizationNumber = t("d17.err_auth_format");
    } else if (auth.value.trim().length < 4 || auth.value.trim().length > 32) {
      errors.authorizationNumber = t("d17.err_auth_format");
    }

    if (!phone?.value.trim()) {
      errors.senderPhone = t("d17.err_phone");
    } else if (!/^\d{8}$/.test(phone.value.trim())) {
      errors.senderPhone = t("d17.err_phone");
    }

    if (!confirmed) {
      errors.confirm = t("d17.err_confirm");
    }

    return errors;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPending(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/checkout/d17/proof", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });

      if (res.ok) {
        setSuccess(true);
        formRef.current?.reset();
        setConfirmed(false);
        setFieldErrors({});
        // Brief success display before refresh so the user sees confirmation
        setTimeout(() => router.refresh(), 1500);
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

  /** Clear a field error when the user starts correcting it. */
  function clearFieldError(field: keyof FieldErrors) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-6" noValidate>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="lang" value={lang} />

      {/* Authorization number */}
      <div className="grid gap-2">
        <AuthField
          id="d17-auth"
          name="authorizationNumber"
          label={t("d17.field_auth")}
          type="text"
          autoComplete="off"
          describedBy="d17-auth-hint"
          onChange={() => clearFieldError("authorizationNumber")}
        />
        <p id="d17-auth-hint" className="text-xs leading-relaxed text-gray-500">
          {t("d17.field_auth_hint")}
        </p>
        {fieldErrors.authorizationNumber && (
          <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {fieldErrors.authorizationNumber}
          </p>
        )}
      </div>

      {/* Sender phone */}
      <div className="grid gap-2">
        <AuthField
          id="d17-phone"
          name="senderPhone"
          label={t("d17.field_phone")}
          type="tel"
          autoComplete="tel"
          describedBy="d17-phone-hint"
          onChange={() => clearFieldError("senderPhone")}
        />
        <p id="d17-phone-hint" className="text-xs leading-relaxed text-gray-500">
          {t("d17.field_phone_hint")}
        </p>
        {fieldErrors.senderPhone && (
          <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {fieldErrors.senderPhone}
          </p>
        )}
      </div>

      {/* Screenshot upload */}
      <div className="grid gap-2">
        <Label htmlFor="d17-screenshot" className="text-sm font-medium text-gray-900">
          {t("d17.field_screenshot")}
        </Label>
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-1 transition-colors hover:border-gray-400 focus-within:border-black focus-within:ring-1 focus-within:ring-black/20">
          <Input
            id="d17-screenshot"
            name="screenshot"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-describedby="d17-screenshot-hint"
            onChange={() => clearFieldError("screenshot")}
            className="border-0 bg-transparent file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 file:shadow-sm file:transition-colors hover:file:bg-gray-50"
          />
        </div>
        <p id="d17-screenshot-hint" className="text-xs leading-relaxed text-gray-500">
          {t("d17.field_screenshot_hint")}
        </p>
        {fieldErrors.screenshot && (
          <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {fieldErrors.screenshot}
          </p>
        )}
      </div>

      {/* Confirmation checkbox */}
      <div className="grid gap-2 pt-1">
        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
          <input
            id="d17-confirm"
            name="confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              if (e.target.checked) clearFieldError("confirm");
            }}
            className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-gray-300 accent-black"
            aria-invalid={!!fieldErrors.confirm}
          />
          <Label
            htmlFor="d17-confirm"
            className="cursor-pointer text-sm font-normal leading-relaxed text-gray-700"
          >
            {t("d17.field_confirm")}
          </Label>
        </div>
        {fieldErrors.confirm && (
          <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {fieldErrors.confirm}
          </p>
        )}
      </div>

      {/* Server error banner */}
      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Success feedback */}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          {t("d17.state_submitted_explain")}
        </div>
      )}

      {/* Submit button */}
      <div className="grid gap-3 pt-2">
        <Button
          type="submit"
          size="lg"
          disabled={pending || disabled}
          aria-busy={pending || undefined}
          className="relative w-full shadow-sm transition-all hover:shadow-md disabled:opacity-60"
        >
          {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
          {pending ? t("d17.submitting") : t("d17.submit")}
        </Button>
      </div>
    </form>
  );
}