"use client";

import { useActionState } from "react";
import { AuthSubmitButton } from "@/components/auth/submit-button";
import {
  confirmEmailAction,
  resendVerificationAction,
  type ConfirmEmailState,
  type ResendState,
} from "@/lib/auth/verify-actions";

/**
 * ConfirmEmailForm — the "Confirm your email" button.
 *
 * A button, not an auto-submitting page: scanners fetch links before a
 * human does, and a link that consumes on GET would verify an address
 * nobody confirmed and burn the token before the customer clicks it.
 */
export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action] = useActionState(confirmEmailAction, {} as ConfirmEmailState);

  if (state.done) {
    return (
      <div
        role="status"
        className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-5 text-center"
      >
        <p className="text-sm font-medium text-black">Email confirmed</p>
        <p className="mt-1 text-sm text-gray-600">
          {state.email ? `${state.email} is verified. ` : ""}You can create an
          API key and start a subscription.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      {state.error ? (
        <p role="alert" aria-live="assertive" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <AuthSubmitButton label="Confirm my email" pendingLabel="Confirming\u2026" />
    </form>
  );
}

/**
 * ResendVerification — the dashboard's recovery path when the first mail
 * was lost. Sends only to the signed-in identity.
 */
export function ResendVerification() {
  const [state, action] = useActionState(resendVerificationAction, {} as ResendState);

  if (state.done) {
    return (
      <p role="status" className="text-sm text-gray-600">
        Sent. Check your inbox for the confirmation link.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {state.error ? (
        <p role="alert" aria-live="assertive" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <AuthSubmitButton label="Resend confirmation email" pendingLabel="Sending\u2026" />
    </form>
  );
}
