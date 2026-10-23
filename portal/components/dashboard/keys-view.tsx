"use client";

import * as React from "react";
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiSend, useApi } from "@/lib/api/use-api";
import type { KeyView, SubscriptionBundle } from "@/lib/api/types";
import { ErrorState, FirstUseState, PaywallState, RefreshingBar, PanelSkeleton } from "@/components/dashboard/states";
import { relativeTime } from "@/lib/dashboard/format";
import { toast } from "sonner";

/**
 * KeysView — the API-key manager, live.
 *
 * This component used to generate keys with `crypto.getRandomValues` and
 * keep them in `useState`: the create, list and revoke endpoints had no
 * caller in the product at all. Every mutation now goes to the real route,
 * which means every rule in `lib/keys/service.ts` is finally enforced in
 * the place a customer meets it:
 *
 *   - `POST /api/keys` answers `402 payment_required` when the org has no
 *     live plan. That is not an error to retry — it is the paywall, so it
 *     renders the paywall panel instead of a toast.
 *   - `409` when the plan's key ceiling is reached. The button is disabled
 *     when the bundle says so; this is the server disagreeing, and it
 *     wins.
 *   - The plaintext comes back ONCE in the create response and is held in
 *     one piece of state that is cleared when the customer acknowledges it.
 *     There is no code path that can fetch it again, which is the same
 *     promise the backend makes.
 *
 * `revoke` is destructive and irreversible (LiteLLM soft-deletes, but the
 * credential stops authenticating immediately), so it is confirmed and the
 * row stays in the list, dimmed — the ledger rows that reference it must
 * stay readable.
 */
export function KeysView() {
  const { data, error, loading, refreshing, reload, set } = useApi<{
    keys: KeyView[];
  }>("/api/keys");
  const bundle = useApi<SubscriptionBundle>("/api/subscription");

  const [plaintext, setPlaintext] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<KeyView | null>(null);
  const [revoking, setRevoking] = React.useState(false);

  const keys = data?.keys ?? [];
  const plan = bundle.data?.plan ?? null;
  const activeCount = keys.length; // /api/keys returns ACTIVE keys only
  const maxKeys = plan?.maxKeys ?? bundle.data?.keys.max ?? null;
  const atCeiling = maxKeys !== null && activeCount >= maxKeys;
  const noPlan = bundle.data?.state === "no_subscription";

  /** Refresh both: a create changes the key list AND the bundle's count. */
  function refreshAll() {
    reload();
    bundle.reload();
  }

  async function createKey() {
    const name = newName.trim();
    if (!name || creating) return;

    setCreating(true);
    // Models come from the plan, never from the user: the service
    // validates them as a subset anyway, and a hand-picked list can only
    // ever be wrong.
    const models = plan?.models ?? [];

    const result = await apiSend<{ key: KeyView; plaintext: string }>("/api/keys", {
      body: { name, models },
    });

    setCreating(false);

    if ("error" in result) {
      if (result.error.code === "payment_required") {
        toast.error("Choose a plan before creating a key.");
        setCreateOpen(false);
        bundle.reload();
        return;
      }
      toast.error(result.error.message);
      return;
    }

    setPlaintext(result.data.plaintext);
    set({ keys: [result.data.key, ...(data?.keys ?? [])] });
    setNewName("");
    setCreateOpen(false);
    refreshAll();
    toast.success(`Key “${name}” created.`);
  }

  async function revoke(key: KeyView) {
    if (revoking) return;
    setRevoking(true);

    const result = await apiSend<{ id: string; revokedAt: string }>(
      `/api/keys/${key.id}`,
      { method: "DELETE" },
    );

    setRevoking(false);
    setRevokeTarget(null);

    if ("error" in result) {
      // Revoke is upstream-first: if the gateway refused, the key is STILL
      // LIVE. Saying otherwise would be the worst possible lie here.
      toast.error(result.error.message);
      return;
    }

    set({ keys: (data?.keys ?? []).filter((k) => k.id !== key.id) });
    refreshAll();
    toast.success(`${key.name} revoked. It can no longer authenticate.`);
  }

  // ── States ───────────────────────────────────────────────────────────
  if (loading) return <PanelSkeleton rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (noPlan) {
    return (
      <PaywallState
        cta={
          <Button variant="outline" size="sm" nativeButton={false} render={<a href="/dashboard/billing" />}>
            Choose a plan
          </Button>
        }
      />
    );
  }

  return (
    <>
      <RefreshingBar show={refreshing} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="gap-3 py-4 sm:col-span-1">
          <CardHeader className="gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Key slots
            </CardTitle>
            <p className="text-2xl font-semibold tabular-nums">
              {activeCount} / {maxKeys ?? "—"}
            </p>
          </CardHeader>
          <CardContent>
            <Progress
              value={maxKeys ? Math.min(100, (activeCount / maxKeys) * 100) : 0}
              aria-label="Key slots used"
              className="[&_[data-slot=progress-track]]:h-1.5"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {plan
                ? `${plan.name} allows ${plan.maxKeys} active keys.`
                : "Your plan's key limit is loading."}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-3 py-4 sm:col-span-2">
          <CardHeader className="gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Before you create a key
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <p>
              Keys authenticate against{" "}
              <code className="rounded bg-muted px-1 font-mono text-xs">/v1/chat/completions</code> and{" "}
              <code className="rounded bg-muted px-1 font-mono text-xs">/v1/messages</code>. Both wire
              formats are served by the same key.
            </p>
            <p>
              The full key is displayed <span className="font-medium text-foreground">once</span>, at
              creation. Store it in your secret manager — we keep only a hash.
            </p>
          </CardContent>
        </Card>
      </div>

      {plaintext ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-500" />
              Copy your new key now
            </CardTitle>
            <CardDescription>
              This is the only time the full key will be shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm break-all">
              {plaintext}
            </code>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(plaintext);
                  toast.success("Key copied to clipboard.");
                } catch {
                  toast.error("Copy failed — select the key and copy it manually.");
                }
              }}
            >
              <Copy />
              Copy
            </Button>
            <Button variant="ghost" onClick={() => setPlaintext(null)}>
              <Check />
              I stored it
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Keys</CardTitle>
              <CardDescription>
                Active credentials for this account
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={refreshAll}
                aria-label="Refresh keys"
                disabled={refreshing}
              >
                <RefreshCw className={refreshing ? "animate-spin" : undefined} />
              </Button>
              <Button
                size="sm"
                disabled={atCeiling || creating}
                title={
                  atCeiling
                    ? `Your plan allows ${maxKeys} keys — revoke one to free a slot.`
                    : undefined
                }
                onClick={() => setCreateOpen(true)}
              >
                <Plus />
                Create key
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {keys.length === 0 ? (
            <FirstUseState
              title="No API keys yet"
              body="Create a key to point your OpenAI- or Anthropic-compatible SDK at this gateway. It takes a few seconds."
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)} disabled={atCeiling}>
                  <Plus />
                  Create your first key
                </Button>
              }
            />
          ) : (
            <Table className="table-fixed">
              {/* Same contract as the gateway-calls table: the table always spans
                  the full card width, the flexible column absorbs the rest,
                  and long names truncate instead of stretching the layout. */}
              {/* Percentages summing to 100% so the table always fills the
                  card exactly, at any width. Models takes the largest share
                  because it holds a variable number of badges. */}
              <colgroup>
                <col className="w-[19%]" />
                <col className="w-[14%]" />
                <col className="w-[27%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Models</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell
                      className="max-w-0 truncate pl-6 font-medium"
                      title={key.name}
                    >
                      {key.name}
                      {key.isOwn ? (
                        <Badge variant="outline" className="ml-2">
                          You
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {key.keyPrefix}…
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(key.models ?? []).length > 0 ? (
                          key.models!.map((m) => (
                            <Badge key={m} variant="secondary">
                              {m}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            unknown — the gateway did not report a model list
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(key.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {relativeTime(key.lastUsedAt)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRevokeTarget(key)}
                      >
                        <Trash2 />
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The key inherits your plan&apos;s model access and limits.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Production"
                maxLength={80}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createKey();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Up to 80 characters. Something you will recognize in the usage ledger.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Models</Label>
              {(plan?.models ?? []).length > 0 ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <span className="text-sm font-medium">{plan!.models!.join(", ")}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {plan!.models!.length === 1
                      ? "The only model on your plan"
                      : "Allowed by your plan"}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Loading the model list from your plan…
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              onClick={() => void createKey()}
              disabled={creating || !newName.trim()}
            >
              <KeyRound />
              {creating ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revokeTarget?.name}”?</DialogTitle>
            <DialogDescription>
              The gateway deletes the key immediately — calls using it will fail
              with 401. Usage already recorded stays in your ledger. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Keep key</Button>} />
            <Button
              variant="destructive"
              disabled={revoking}
              onClick={() => revokeTarget && void revoke(revokeTarget)}
            >
              <Trash2 />
              {revoking ? "Revoking…" : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}