"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";

export interface TrialCodeItem {
  id: string;
  code: string;
  trialDays: number;
  maxRedemptions: number;
  redeemedCount: number;
  liveRedemptions: number;
  models: string[];
  validUntil: string;
  active: boolean;
}

/**
 * TrialManager — campaign codes.
 *
 * Until now `trial_codes` had no writer in application code: creating a
 * marketing code meant a shell on the box. This is the same power with an
 * audit row and a role check.
 *
 * THERE IS NO DELETE. `trial_redemptions.trial_code_id` cascades, so deleting a
 * code would erase everyone who redeemed it — a campaign's only evidence that
 * it worked. Deactivating refuses new redemptions and keeps the history.
 *
 * THE USED COUNT COMES FROM THE ROWS, not `trial_codes.redeemed_count`: that
 * column is incremented on redemption and defensively decremented on rollback,
 * so it can drift. `liveRedemptions` is the answer to "how many people".
 */
export function TrialManager({
  codes,
  canManage,
}: {
  codes: TrialCodeItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const [code, setCode] = React.useState("");
  const [days, setDays] = React.useState("3");
  const [maxRedemptions, setMaxRedemptions] = React.useState("0");
  const [models, setModels] = React.useState("fast,smart");

  async function toggle(item: TrialCodeItem) {
    setBusy(item.id);
    try {
      const res = await fetch(`/api/admin/trials/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That change could not be applied.");
        return;
      }
      toast.success(item.active ? `${item.code} deactivated.` : `${item.code} is live again.`);
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("new");
    try {
      const res = await fetch("/api/admin/trials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          trialDays: Number(days),
          maxRedemptions: Number(maxRedemptions),
          models: models
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;

      if (!res.ok) {
        toast.error(data?.error?.message ?? "That code could not be created.");
        return;
      }
      toast.success(`${code.trim().toUpperCase()} created.`);
      setCreating(false);
      setCode("");
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was created.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-end">
        {canManage ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New code
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Viewing only. Creating and retiring a code requires the owner role — a code is money
            with no customer attached.
          </p>
        )}
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="p-3 pl-4 font-medium">Code</th>
              <th className="p-3 font-medium">Trial</th>
              <th className="p-3 font-medium">Used</th>
              <th className="p-3 font-medium">Models</th>
              <th className="p-3 font-medium">Valid until</th>
              <th className="p-3 pr-4 text-right font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id} className="border-b border-border/60 last:border-0">
                <td className="p-3 pl-4 font-mono font-medium">{c.code}</td>
                <td className="p-3">{c.trialDays}d</td>
                <td className="p-3 tabular-nums">
                  {c.liveRedemptions}
                  <span className="text-muted-foreground">
                    {" / "}
                    {c.maxRedemptions === 0 ? "∞" : c.maxRedemptions}
                  </span>
                </td>
                <td className="p-3 text-xs text-muted-foreground">{c.models.join(", ")}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {new Date(c.validUntil).toLocaleDateString()}
                </td>
                <td className="p-3 pr-4 text-right">
                  <Badge variant={c.active ? "default" : "outline"}>{c.active ? "live" : "off"}</Badge>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-2"
                      disabled={busy !== null}
                      onClick={() => toggle(c)}
                    >
                      {busy === c.id ? "…" : c.active ? "Deactivate" : "Activate"}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {codes.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No campaign codes yet.
          </p>
        ) : null}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a trial code</DialogTitle>
            <DialogDescription>
              Redeeming a code attaches the account to the hidden trial plan for the number of days
              below. The code stops accepting redemptions when it is deactivated or its window
              closes.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-2">
              <label htmlFor="trial-code" className="text-sm font-medium">
                Code
              </label>
              <Input
                id="trial-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SPRING26"
                maxLength={64}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <label htmlFor="trial-days" className="text-sm font-medium">
                  Days
                </label>
                <Input
                  id="trial-days"
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="trial-max" className="text-sm font-medium">
                  Max redemptions
                </label>
                <Input
                  id="trial-max"
                  type="number"
                  min={0}
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">0 = unlimited</p>
              </div>
            </div>
            <div className="grid gap-2">
              <label htmlFor="trial-models" className="text-sm font-medium">
                Models
              </label>
              <Input
                id="trial-models"
                value={models}
                onChange={(e) => setModels(e.target.value)}
                placeholder="fast,smart"
              />
              <p className="text-xs text-muted-foreground">Comma-separated aliases.</p>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button disabled={busy !== null || code.trim().length < 3} onClick={create}>
              {busy ? "Creating…" : "Create code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
