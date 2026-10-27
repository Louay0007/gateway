"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldOff, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dateTime } from "@/lib/dashboard/format";

import type { StaffRow } from "@/lib/admin/staff";
import type { StaffRole } from "@/lib/auth/staff-roles";

/**
 * StaffManager — who can reach the console, and revoking that.
 *
 * Until migration 0015 this was a CLI script, which meant granting an
 * operator access required a shell on the VPS — and so did revoking it.
 * That is unacceptable for a role that can suspend a paying customer and
 * approve their payment: access had to be granted out-of-band, so it
 * could only be withdrawn out-of-band, and only by someone with database
 * access.
 *
 * THERE IS NO DELETE BUTTON. Revocation writes `revoked_at` and
 * `requireStaff` refuses the account on its next request. Deleting the
 * row would leave `credit_notes.created_by` and `audit_log.actor_id`
 * pointing at an id that no longer exists — destroying the evidence of
 * who moved money. A revoked operator stays in this list forever.
 *
 * SELF-EDIT AND LAST-OWNER ARE REFUSED BY THE SERVER, not here, because
 * both rules depend on database state this component cannot see. The UI
 * hides the buttons as a courtesy; the route is the authority.
 */
export function StaffManager({
  staff,
  roles,
  roleSummary,
  canManage,
  selfId,
}: {
  staff: StaffRow[];
  roles: readonly StaffRole[];
  roleSummary: Record<StaffRole, string>;
  canManage: boolean;
  selfId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [granting, setGranting] = React.useState(false);

  const activeOwners = staff.filter((s) => s.role === "owner" && !s.revokedAt).length;

  async function act(id: string, kind: "role" | "revoke", role?: StaffRole) {
    setBusy(`${id}:${kind}`);
    try {
      const res = await fetch(`/api/admin/staff/${id}`, {
        method: kind === "revoke" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(kind === "role" ? { body: JSON.stringify({ role }) } : {}),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        toast.error(data?.error?.message ?? "That change could not be applied.");
        return;
      }
      toast.success(
        kind === "revoke" ? "Access revoked. It takes effect on their next request." : `Role changed to ${role}.`,
      );
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {canManage ? (
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={() => setGranting(true)}>
            <UserPlus />
            Grant access
          </Button>
        </div>
      ) : (
        <p className="text-right text-xs text-muted-foreground">
          Granting, changing and revoking staff access requires the owner
          role — `read_only` can already see every customer and payment in
          the product.
        </p>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Operator</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Granted by</TableHead>
              <TableHead className="pr-4">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((s) => {
              const isSelf = s.id === selfId;
              const isLastOwner = s.role === "owner" && !s.revokedAt && activeOwners <= 1;
              return (
                <TableRow key={s.id} className={s.revokedAt ? "opacity-60" : undefined}>
                  <TableCell className="pl-4 font-medium">
                    {s.name ?? s.email}
                    <span className="block text-xs text-muted-foreground">{s.email}</span>
                  </TableCell>
                  <TableCell>
                    {canManage && !isSelf && !s.revokedAt ? (
                      <Select
                        value={s.role}
                        onValueChange={(v) => void act(s.id, "role", v as StaffRole)}
                        disabled={busy !== null}
                      >
                        <SelectTrigger size="sm" className="w-32" aria-label={`Role for ${s.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={s.revokedAt ? "secondary" : "default"}>{s.role}</Badge>
                    )}
                    {isSelf ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        you · cannot change your own role
                      </span>
                    ) : isLastOwner ? (
                      <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                        only owner
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.revokedAt ? "destructive" : "default"}>
                      {s.revokedAt ? "revoked" : "active"}
                    </Badge>
                    {!s.hasCredential && !s.revokedAt ? (
                      <p className="mt-1 max-w-40 truncate text-xs text-amber-600 dark:text-amber-400">
                        no sign-in account yet
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.createdBy ?? "seeded"}
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {dateTime(s.createdAt)}
                      </span>
                      {canManage && !isSelf && !s.revokedAt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={busy !== null}
                          onClick={() => void act(s.id, "revoke")}
                        >
                          <ShieldOff />
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="mt-4 grid gap-1 text-xs text-muted-foreground">
        {roles.map((r) => (
          <li key={r}>
            <span className="font-medium text-foreground">{r}</span> — {roleSummary[r]}
          </li>
        ))}
      </ul>

      <GrantDialog
        open={granting}
        roles={roles}
        onClose={() => setGranting(false)}
        onDone={() => {
          setGranting(false);
          router.refresh();
        }}
      />
    </>
  );
}

function GrantDialog({
  open,
  roles,
  onClose,
  onDone,
}: {
  open: boolean;
  roles: readonly StaffRole[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<StaffRole>("support");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRole("support");
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || null, role }),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        toast.error(data?.error?.message ?? "Access could not be granted.");
        return;
      }
      toast.success(`Access granted to ${email.trim()}.`);
      onDone();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant staff access</DialogTitle>
          <DialogDescription>
            Grants access to an account that already exists. It does not
            create a sign-in — run <code>scripts/create-accounts.ts</code>
            if the person has no password yet.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@example.com"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={() => void submit()} disabled={busy || !email.trim()}>
            {busy ? "Granting…" : "Grant access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}