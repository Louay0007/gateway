"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * RecoveryActions — unlock a lockout, re-send a verification link.
 *
 * BOTH ROUTES TAKE AN EMAIL, not a row id, because that is what an operator
 * has in front of them on a support call. The email is normalised server-side
 * and matched on `lower()`, so case cannot produce a "no such account".
 *
 * NEITHER IS A PASSWORD RESET. Unlock clears a throttle bucket (putting the
 * identity in exactly the state a successful sign-in leaves it); re-send mails
 * a link the customer must still click. Staff cannot set a customer's password
 * — that is impersonation by another name, which this console does not do.
 */
export function RecoveryActions({
  kind,
  email,
  label,
}: {
  kind: "unlock" | "verification";
  email: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function run() {
    setBusy(true);
    try {
      const path =
        kind === "unlock" ? "/api/admin/system/unlock" : "/api/admin/system/resend-verification";
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
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={run}>
      {busy ? "Working…" : label}
    </Button>
  );
}
