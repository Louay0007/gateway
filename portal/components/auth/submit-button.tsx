"use client";

import { useFormStatus } from "react-dom";

/**
 * AuthSubmitButton — native submit with pending state.
 *
 * Client only because useFormStatus must read the enclosing <form>.
 * Disabled while pending: double-submits would double-run the server
 * action (and double-record throttle failures).
 *
 * Pro polish (ui-ux-pro-max rulebook):
 * - h-11 (44px) touch minimum, same rhythm as the fields.
 * - `aria-busy` announces the pending state; the label swap alone is not
 *   enough for screen readers.
 * - Visible focus ring (keyboard users tab here first); `active:scale`
 *   gives the 100ms tactile press feedback the rulebook demands.
 * - `motion-reduce` kills the press animation for vestibular safety.
 */
export function AuthSubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="h-11 w-full rounded-lg bg-black text-sm font-medium text-white transition-all duration-150 hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none active:scale-[0.99] disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
