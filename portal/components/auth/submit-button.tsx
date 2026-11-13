"use client";

import { Button } from "@/components/ui/button";

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
  // The one place a `Button` variant genuinely differs: this must be a full-
  // width 44px target on a phone, which is taller than any button size in
  // the system. Everything else — colour, focus ring, disabled state — now
  // comes from the primitive instead of being restated here.
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="h-11 w-full text-sm motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}
