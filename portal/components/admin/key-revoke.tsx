"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * KeyRevoke — kill a leaked credential from the console.
 *
 * THE GAP THIS FILLS. The drill-down showed key prefixes and could not revoke
 * one, so during a leak the customer had to be talked through their own
 * dashboard while the key stayed live. Every second of that call is a second
 * the credential works.
 *
 * KEY MATERIAL IS NEVER SHOWN OR READ. The prefix identifies the key; the id is
 * what the revoke takes. `key_hash` is not selected by any query behind this.
 *
 * A reason is optional: the revocation itself is the record, and requiring one
 * during an incident costs seconds that matter. Anything typed is audited.
 */
export function KeyRevoke({
  orgId,
  keyId,
  keyName,
  keyPrefix,
  disabled,
}: {
  orgId: string;
  keyId: string;
  keyName: string;
  keyPrefix: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function revoke() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/keys/${keyId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That key could not be revoked.");
        return;
      }
      toast.success(`${keyName} revoked. It stops working immediately.`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
        Revoke
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this key?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{keyPrefix}…</span> stops working immediately, including
              for anything already using it. This cannot be undone — the customer creates a new key.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <label htmlFor="key-reason" className="text-sm font-medium">
              Reason (optional)
            </label>
            <Input
              id="key-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Leaked in a public repository"
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" disabled={busy} onClick={revoke}>
              {busy ? "Revoking…" : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
