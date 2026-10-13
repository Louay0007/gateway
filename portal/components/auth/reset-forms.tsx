"use client";

import { useActionState } from "react";
import {
  completeResetAction,
  requestResetAction,
  type ResetConfirmState,
  type ResetRequestState,
} from "@/lib/auth/reset-actions";
import { AuthField } from "@/components/auth/auth-fields";
import { AuthSubmitButton } from "@/components/auth/submit-button";

/**
 * RequestResetForm — email only. Data contract matches
 * requestResetAction: field `email`; always answers { done: true } on a
 * valid address (even for unknown or throttled emails — the success
 * screen is identical so the endpoint leaks nothing).
 */
export function RequestResetForm() {
  const [state, action] = useActionState(requestResetAction, {} as ResetRequestState);
  if (state.done) {
    return (
      <div role="status" className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-5 text-center">
        <p className="text-sm font-medium text-black">Check your inbox</p>
        <p className="mt-1 text-sm text-gray-600">
          If an account exists for that address, a reset link is on its way.
          It expires in 30 minutes.
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        error={state.fieldErrors?.email}
      />
      {state.error ? (
        <p role="alert" aria-live="assertive" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <AuthSubmitButton label="Send reset link" pendingLabel="Sending\u2026" />
    </form>
  );
}

/**
 * CompleteResetForm — new password + confirm for a token-bearing link.
 * Data contract matches completeResetAction: fields `token` (hidden),
 * `password`, `confirmPassword`. One generic failure message covers
 * expired, unknown, and already-used tokens.
 */
export function CompleteResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(completeResetAction, {} as ResetConfirmState);
  if (state.done) {
    return (
      <div role="status" className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-5 text-center">
        <p className="text-sm font-medium text-black">Password updated</p>
        <p className="mt-1 text-sm text-gray-600">
          You can now sign in with the new password.
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <AuthField
        id="password"
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.password}
      />
      <AuthField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
      />
      {state.error ? (
        <p role="alert" aria-live="assertive" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <AuthSubmitButton label="Set new password" pendingLabel="Saving\u2026" />
    </form>
  );
}
