"use client";

import * as React from "react";
import { Bell, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiSend, useApi } from "@/lib/api/use-api";
import { ErrorState, PanelSkeleton } from "@/components/dashboard/states";

/**
 * NotificationsCard — the customer's own quota warnings.
 *
 * WHY THIS TAB EXISTS. Before 0051 the only way to learn a pool was
 * exhausted was a request returning "Out of tokens for this period". The
 * first warning was the failure. These switches are what make the warning
 * arrive first.
 *
 * THE DEFAULTS ARE THE FEATURE. `GET` answers the defaults when no row
 * exists, so a customer who never opens this tab still gets the 80/95
 * mails. This form therefore starts from what the job will actually do,
 * not from an empty state that implies "nothing is configured".
 *
 * NOT A TOGGLE FOR EVERYTHING. `channel: none` is the single off switch;
 * the two booleans are independent because "warn me before I run out" and
 * "tell me about one odd call" are different requests.
 */
interface AlertPrefs {
  thresholds: number[];
  channel: "email" | "none";
  onExhausted: boolean;
  onAnomaly: boolean;
}

export function NotificationsCard() {
  const prefs = useApi<AlertPrefs>("/api/notifications");
  const [thresholds, setThresholds] = React.useState<string>("80, 95");
  const [saving, setSaving] = React.useState(false);

  // Seed the text field once the server answers. `useEffect` on the data,
  // not on every render, so typing is never overwritten mid-edit.
  React.useEffect(() => {
    if (prefs.data) setThresholds(prefs.data.thresholds.join(", "));
  }, [prefs.data]);

  if (prefs.loading && !prefs.data) return <PanelSkeleton rows={3} />;
  if (prefs.error) return <ErrorState error={prefs.error} onRetry={prefs.reload} />;
  if (!prefs.data) return null;

  const enabled = prefs.data.channel === "email";

  async function save(patch: Partial<AlertPrefs>) {
    setSaving(true);
    // Optimistic, then server-confirmed: a switch that does nothing until a
    // round trip feels broken on a slow connection.
    prefs.set({ ...prefs.data!, ...patch });
    const res = await apiSend<{ ok: true }>("/api/notifications", {
      method: "PATCH",
      body: patch,
    });
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error.message);
      prefs.reload();
      return;
    }
    prefs.reload();
  }

  async function saveThresholds() {
    const parsed = thresholds
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 100);
    if (parsed.length === 0) {
      toast.error("Enter at least one percentage between 1 and 100.");
      return;
    }
    await save({ thresholds: [...new Set(parsed)].sort((a, b) => a - b) });
    toast.success("Saved.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell />
          Quota notifications
        </CardTitle>
        <CardDescription>
          Email yourself before the pool runs out, rather than finding out
          from a failed request.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="notify-email">Email me at these thresholds</Label>
            <p className="text-xs text-muted-foreground">
              One mail per threshold per billing period. Sent to your account
              address.
            </p>
          </div>
          <Switch
            id="notify-email"
            checked={enabled}
            disabled={saving}
            onCheckedChange={(on) => save({ channel: on ? "email" : "none" })}
            aria-label="Email quota threshold warnings"
          />
        </div>

        {enabled ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor="notify-thresholds">Warning thresholds (%)</Label>
              <div className="flex gap-2">
                <Input
                  id="notify-thresholds"
                  value={thresholds}
                  onChange={(e) => setThresholds(e.target.value)}
                  placeholder="80, 95"
                  inputMode="numeric"
                  className="max-w-40"
                />
                <Button
                  variant="outline"
                  onClick={saveThresholds}
                  disabled={saving}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Comma-separated. The dashboard uses the same 80% and 95%
                thresholds for its colour, so the mail and the meter agree.
              </p>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-1">
                <Label htmlFor="notify-exhausted">Tell me when the pool is spent</Label>
                <p className="text-xs text-muted-foreground">
                  Every model pauses at that point; this is the mail that says
                  when it resumes.
                </p>
              </div>
              <Switch
                id="notify-exhausted"
                checked={prefs.data.onExhausted}
                disabled={saving}
                onCheckedChange={(on) => save({ onExhausted: on })}
                aria-label="Email when the token pool is exhausted"
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-1">
                <Label htmlFor="notify-anomaly">Tell me about unusual calls</Label>
                <p className="text-xs text-muted-foreground">
                  A single request far larger than your daily average. Off by
                  default — it is a signal, not a warning.
                </p>
              </div>
              <Switch
                id="notify-anomaly"
                checked={prefs.data.onAnomaly}
                disabled={saving}
                onCheckedChange={(on) => save({ onAnomaly: on })}
                aria-label="Email about unusual single requests"
              />
            </div>
          </>
        ) : (
          <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <Mail className="size-4" />
            All quota email is off. You will only find out about an empty pool
            from a failed request.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
