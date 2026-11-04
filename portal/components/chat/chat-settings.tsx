"use client";

import * as React from "react";
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
import { PanelSkeleton } from "@/components/dashboard/states";
import { useApi, apiSend } from "@/lib/api/use-api";
import type { GenerationSettings } from "@/lib/chat/preset";

/**
 * ChatSettings — the GLOBAL generation preset (scope '').
 *
 * One scope, not three. The per-alias and per-conversation layers exist in
 * the data model (0027) and are read by the route, but exposing three
 * editors for values that are almost always set once is a settings page
 * that answers a question nobody asked. Global covers the real want ("be
 * terse", "use a lower temperature") and per-chat overrides can land later
 * without a migration.
 *
 * Saving writes through PUT /api/chat/presets, and the route merges the
 * layers on every turn — so this is not cosmetic: the next message uses it.
 */
export function ChatSettings() {
  const { data, loading, reload } = useApi<{ presets: Record<string, GenerationSettings> }>(
    "/api/chat/presets",
  );
  const [prompt, setPrompt] = React.useState("");
  const [temperature, setTemperature] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const current = data?.presets?.[""] ?? {};

  // Seed the form once, then leave the user's edits alone: re-seeding on
  // every reload would overwrite what they are typing.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || loading || !data) return;
    seeded.current = true;
    setPrompt(current.systemPrompt ?? "");
    setTemperature(current.temperature === undefined ? "" : String(current.temperature));
  }, [current, data, loading]);

  async function save() {
    const parsed = temperature.trim() === "" ? undefined : Number(temperature);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0 || parsed > 2)) {
      toast.error("Temperature must be between 0 and 2.");
      return;
    }

    setSaving(true);
    const res = await apiSend<{ presets: Record<string, GenerationSettings> }>(
      "/api/chat/presets",
      {
        method: "PUT",
        body: {
          scope: "",
          settings: {
            ...(prompt.trim() ? { systemPrompt: prompt.trim() } : {}),
            ...(parsed !== undefined ? { temperature: parsed } : {}),
          },
        },
      },
    );
    setSaving(false);

    if ("error" in res) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Chat defaults saved.");
    reload();
  }

  if (loading) return <PanelSkeleton rows={3} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chat defaults</CardTitle>
        <CardDescription>
          Applied to every conversation. The server adds this as a system
          instruction — it is never something your browser can be tricked into
          changing for one message.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="chat-system-prompt">Instructions</Label>
          <textarea
            id="chat-system-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="Be concise. Prefer code over prose."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>

        <div className="grid gap-1.5 sm:max-w-40">
          <Label htmlFor="chat-temperature">Temperature</Label>
          <Input
            id="chat-temperature"
            inputMode="decimal"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            placeholder="default"
          />
          <p className="text-xs text-muted-foreground">0 to 2. Empty uses the plan default.</p>
        </div>

        <div>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save defaults"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
