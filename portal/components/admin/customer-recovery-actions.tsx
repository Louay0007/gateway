"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * The two recoverability actions, as a client island.
 *
 * WHY A CLIENT COMPONENT FOR TWO BUTTONS. Both call a route that writes and
 * audits; both need a pending state, a toast and a `router.refresh()` so the
 * page reflects the new state without a manual reload. Inlining them as server
 * actions would mean two more `'use server'` modules for eight lines each.
 *
 * NEITHER IS A PASSWORD RESET. Unlocking clears a throttle bucket; re-sending
 * mails a confirmation link the customer still has to click. Staff cannot set a
 * customer's password — that would be impersonation by another name, which the
 * console does not do.
 */
export function CustomerRecoveryActions({
  email,
  lockedOut,
  verified,
}: {
  email: string;
  lockedOut: boolean;
  verified: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"unlock" | "verify" | null>(null);

  async function post(path: string, which: "unlock" | "verify") {
    setBusy(which);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: { message?: string }; message?: string }
        | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That action could not be completed.");
        return;
      }
      toast.success(data?.message ?? "Done.");
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null || !lockedOut}
        onClick={() => post("/api/admin/system/unlock", "unlock")}
      >
        {busy === "unlock" ? "Unlocking…" : lockedOut ? "Unlock sign-in" : "Not locked out"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null || verified}
        onClick={() => post("/api/admin/system/resend-verification", "verify")}
      >
        {busy === "verify" ? "Sending…" : verified ? "Already verified" : "Re-send verification"}
      </Button>
    </div>
  );
}
