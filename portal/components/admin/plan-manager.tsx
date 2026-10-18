"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Plus, Pencil } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { usd, usdPrecise } from "@/lib/dashboard/format";

import type { PlanAdminRow } from "@/lib/admin/plans";

const FIELD =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

/**
 * PlanManager — the catalog editor.
 *
 * WHY THERE IS NO `overage_markup_bps` FIELD. That is not an oversight.
 * The identity `overage_markup_bps === rate_multiplier_bps − 10000` is
 * enforced by `tests/security.test.ts` and holds on every row in
 * production. Exposing both fields would let an operator set a multiplier
 * and a markup that disagree, and nothing would fail: every invoice
 * would simply be wrong by the difference. So the server DERIVES the
 * markup from the multiplier on every write, and this form sends only
 * the multiplier — the derived value is shown read-only underneath so
 * the relationship is visible rather than hidden.
 *
 * RETIRE, NOT DELETE. There is no delete button and there will not be
 * one: `subscriptions.plan_id` is a NOT NULL foreign key, so removing a
 * plan any customer is on would either error or orphan their
 * subscription. Archiving hides it from `/api/plans` and the pricing
 * page while leaving every live subscription intact.
 */
export function PlanManager({
  plans,
  canEdit,
}: {
  plans: PlanAdminRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<PlanAdminRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function toggleArchive(plan: PlanAdminRow) {
    setBusy(plan.id);
    try {
      const restore = !plan.public;
      const res = await fetch(`/api/admin/plans/${plan.id}?action=${restore ? "restore" : ""}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        toast.error(data?.error?.message ?? "That plan could not be changed.");
        return;
      }
      toast.success(restore ? `${plan.name} is published again.` : `${plan.name} is retired.`);
      router.refresh();
    } catch {
      toast.error("The network request failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-end">
        {canEdit ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New plan
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Viewing only. Editing plans requires the owner role — a plan
            decides what every customer on it pays.
          </p>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Plan</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Included</TableHead>
              <TableHead className="text-right">Hard cap</TableHead>
              <TableHead className="text-right">Multiplier</TableHead>
              <TableHead className="text-right">Markup</TableHead>
              <TableHead>Limits</TableHead>
              <TableHead className="text-right">Subscribers</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-6 font-medium">
                  {p.name}
                  <span className="block font-mono text-xs text-muted-foreground">
                    {p.code}
                    {p.trialDays > 0 ? ` · ${p.trialDays}d trial` : ""}
                  </span>
                  {!p.public ? (
                    <Badge variant="secondary" className="mt-1">
                      retired
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usd(p.priceCents / 100)}
                  <span className="block text-xs text-muted-foreground">/{p.interval}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usdPrecise(p.includedSpendCents / 100)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.hardCapCents === null ? "—" : usd(p.hardCapCents / 100)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {(p.rateMultiplierBps / 10000).toFixed(2)}×
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {(p.overageMarkupBps / 10000).toFixed(2)}×
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {p.rpmLimit ?? "∞"} rpm · {p.tpmLimit ? `${(p.tpmLimit / 1000).toFixed(0)}k` : "∞"} tpm
                  <span className="block">{p.models.join(", ")}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.subscriberCount}</TableCell>
                <TableCell className="pr-6 text-right">
                  <div className="flex justify-end gap-1">
                    {canEdit ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => setEditing(p)}
                        >
                          <Pencil />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void toggleArchive(p)}
                        >
                          {p.public ? <Archive /> : <ArchiveRestore />}
                          {p.public ? "Retire" : "Restore"}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PlanDialog
        open={creating || editing !== null}
        plan={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onDone={() => {
          setCreating(false);
          setEditing(null);
          router.refresh();
        }}
      />
    </>
  );
}

function PlanDialog({
  open,
  plan,
  onClose,
  onDone,
}: {
  open: boolean;
  plan: PlanAdminRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [priceCents, setPriceCents] = React.useState("");
  const [includedCents, setIncludedCents] = React.useState("");
  const [hardCapCents, setHardCapCents] = React.useState("");
  const [multiplier, setMultiplier] = React.useState("1.30");
  const [rpm, setRpm] = React.useState("");
  const [tpm, setTpm] = React.useState("");
  const [maxKeys, setMaxKeys] = React.useState("1");
  const [trialDays, setTrialDays] = React.useState("0");
  const [models, setModels] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCode(plan?.code ?? "");
    setName(plan?.name ?? "");
    setPriceCents(plan ? String(plan.priceCents) : "");
    setIncludedCents(plan ? String(plan.includedSpendCents) : "0");
    setHardCapCents(plan?.hardCapCents == null ? "" : String(plan.hardCapCents));
    setMultiplier(plan ? (plan.rateMultiplierBps / 10000).toFixed(2) : "1.30");
    setRpm(plan?.rpmLimit == null ? "" : String(plan.rpmLimit));
    setTpm(plan?.tpmLimit == null ? "" : String(plan.tpmLimit));
    setMaxKeys(plan ? String(plan.maxKeys) : "1");
    setTrialDays(plan ? String(plan.trialDays) : "0");
    setModels(plan?.models.join(", ") ?? "");
  }, [open, plan]);

  const mult = Number.parseFloat(multiplier);
  const derivedMarkup = Number.isFinite(mult) ? (mult - 1) * 100 : null;

  async function submit() {
    setBusy(true);
    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        priceCents: Math.round(Number(priceCents)),
        includedSpendCents: Math.round(Number(includedCents || "0")),
        hardCapCents: hardCapCents.trim() === "" ? null : Math.round(Number(hardCapCents)),
        rateMultiplierBps: Math.round(mult * 10000),
        rpmLimit: rpm.trim() === "" ? null : Number(rpm),
        tpmLimit: tpm.trim() === "" ? null : Number(tpm),
        maxKeys: Number(maxKeys || "1"),
        trialDays: Number(trialDays || "0"),
        models: models.split(",").map((m) => m.trim()).filter(Boolean),
      };

      const res = await fetch(plan ? `/api/admin/plans/${plan.id}` : "/api/admin/plans", {
        method: plan ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        toast.error(data?.error?.message ?? "The plan could not be saved.");
        return;
      }
      toast.success(plan ? `${body.name} updated.` : `${body.name} created.`);
      onDone();
    } catch {
      toast.error("The network request failed. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : "New plan"}</DialogTitle>
          <DialogDescription>
            Price is in cents. The overage markup is derived from the
            multiplier and cannot be set independently — the two must
            agree or every invoice is wrong.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={FIELD} placeholder="starter" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} placeholder="Starter" />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Price (cents / month)</span>
            <input type="number" value={priceCents} onChange={(e) => setPriceCents(e.target.value)} className={FIELD} placeholder="1900" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Included spend (cents)</span>
            <input type="number" value={includedCents} onChange={(e) => setIncludedCents(e.target.value)} className={FIELD} />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Hard cap (cents, blank = none)</span>
            <input type="number" value={hardCapCents} onChange={(e) => setHardCapCents(e.target.value)} className={FIELD} />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Rate multiplier</span>
            <input value={multiplier} onChange={(e) => setMultiplier(e.target.value)} className={FIELD} />
            <span className="text-xs text-muted-foreground">
              {derivedMarkup === null ? (
                "Enter a number."
              ) : (
                <>
                  → markup{" "}
                  <strong>
                    {((derivedMarkup / 100)).toFixed(2)}×
                  </strong>{" "}
                  (derived, not editable)
                </>
              )}
            </span>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">RPM (blank = unlimited)</span>
            <input type="number" value={rpm} onChange={(e) => setRpm(e.target.value)} className={FIELD} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">TPM (blank = unlimited)</span>
            <input type="number" value={tpm} onChange={(e) => setTpm(e.target.value)} className={FIELD} />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Max keys</span>
            <input type="number" value={maxKeys} onChange={(e) => setMaxKeys(e.target.value)} className={FIELD} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Trial days (0 = none)</span>
            <input type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} className={FIELD} />
          </label>

          <label className="grid gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium">Models (comma separated aliases)</span>
            <input value={models} onChange={(e) => setModels(e.target.value)} className={FIELD} placeholder="fast, smart" />
            <span className="text-xs text-muted-foreground">
              Aliases only — <code>fast</code>, <code>smart</code>, <code>frontier</code>.
              Upstream model names are never shown to customers.
            </span>
          </label>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : plan ? "Save changes" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}