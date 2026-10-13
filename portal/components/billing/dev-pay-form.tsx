"use client";

import { useActionState } from "react";

import { AuthSubmitButton } from "@/components/auth/submit-button";
import { payDevSubscription, type DevPayState } from "@/lib/billing/dev-actions";

const INITIAL: DevPayState = {};

/**
 * The simulator's pay button.
 *
 * Everything identifying is a hidden field rendered by the page: the
 * subscription id, the activation nonce, and the validated return path.
 * The form decides nothing — the action re-reads the subscription, proves
 * the caller's org owns it, and routes the activation through the real
 * webhook endpoint.
 */
export function DevPayForm({
  subscriptionId,
  nonce,
  returnTo,
  amountLabel,
}: {
  subscriptionId: string;
  nonce: string;
  returnTo: string;
  amountLabel: string;
}) {
  const [state, action] = useActionState(payDevSubscription, INITIAL);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="nonce" value={nonce} />
      <input type="hidden" name="returnTo" value={returnTo} />

      {state.error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      <AuthSubmitButton
        label={`Simulate payment of ${amountLabel}`}
        pendingLabel="Applying…"
      />
    </form>
  );
}