"use client";

import * as React from "react";
import { ImagePlus, Play, Square, RotateCcw, KeyRound, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { drainFrames, parseFrame, type PlaygroundUsage } from "@/lib/playground/parse";

/**
 * Playground — one prompt, one streamed answer, and the REAL cost of it.
 *
 * THE KEY IS THE POINT. There is no anonymous mode and no demo key: the
 * visitor pastes their own `zn-` value, the request goes to /api/playground
 * as that key, and the usage block that comes back is the gateway's own
 * number for a call that landed in the same ledger the dashboard reads.
 * A playground that estimated cost would be a marketing widget; this one is
 * the meter, demonstrated.
 *
 * The key is held in React state only — never localStorage, never a cookie.
 * A visitor who reloads must paste it again, which is the correct trade for
 * not leaving a live secret in a browser profile.
 */

const TIERS = [
  { alias: "fast", note: "cheapest" },
  { alias: "smart", note: "balanced" },
  { alias: "frontier", note: "deep" },
  { alias: "fable", note: "long-horizon" },
] as const;

type Tier = (typeof TIERS)[number]["alias"];

export function Playground({ signedIn = false }: { signedIn?: boolean }) {
  const [key, setKey] = React.useState("");
  const [tier, setTier] = React.useState<Tier>("smart");
  const [prompt, setPrompt] = React.useState("");
  const [system, setSystem] = React.useState("");
  const [temperature, setTemperature] = React.useState(1);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [image, setImage] = React.useState<string | null>(null);

  const [answer, setAnswer] = React.useState("");
  const [usage, setUsage] = React.useState<PlaygroundUsage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);

  const canRun = key.trim().length > 0 && prompt.trim().length > 0 && !streaming;

  async function run() {
    if (!canRun) return;
    setStreaming(true);
    setAnswer("");
    setUsage(null);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key.trim()}`,
        },
        body: JSON.stringify({
          alias: tier,
          prompt: prompt.trim(),
          ...(system.trim() ? { system: system.trim() } : {}),
          ...(temperature !== 1 ? { temperature } : {}),
          ...(image ? { image } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Every pre-stream failure is the JSON envelope, including the
        // wall's 403 and a bad key's 401. Surface the gateway's own words
        // — they are the only actionable part.
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? `Request failed (${res.status}).`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("This browser could not read the stream.");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const { payloads, rest } = drainFrames(buffer);
        buffer = rest;

        for (const payload of payloads) {
          const ev = parseFrame(payload);
          if (!ev) continue;
          if (ev.kind === "delta") {
            text += ev.text;
            // Batched by the browser's own paint cycle: setting state per
            // token would re-render faster than the screen refreshes.
            setAnswer(text);
          } else if (ev.kind === "usage") {
            setUsage(ev.usage);
          } else if (ev.kind === "error") {
            setError(ev.message);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // Stopping is not a failure; keep whatever streamed.
        return;
      }
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function reset() {
    setAnswer("");
    setUsage(null);
    setError(null);
    setImage(null);
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file is not an image.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Images must be under 4 MB.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("Could not read that file."));
      fr.readAsDataURL(file);
    });
    setImage(dataUrl);
    setError(null);
  }

  return (
    <div className="grid gap-6">
      {/* ── Key ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <label className="grid gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <KeyRound className="size-4" aria-hidden />
            Your zn- API key
          </span>
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="zn-…"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {signedIn ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href="/dashboard/keys" />}
                className="shrink-0"
              >
                My keys
              </Button>
            ) : null}
          </div>
          <span className="text-xs leading-relaxed text-muted-foreground">
            The playground runs on your own key — no demo key exists, so the
            cost below is your real cost and lands in your own usage. The key
            stays in this browser tab.{" "}
            {signedIn ? null : (
              <>
                No key yet?{" "}
                <a href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
                  Start a 3-day trial
                </a>
                .
              </>
            )}
          </span>
        </label>
      </div>

      {/* ── Controls ─────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Tier
          </p>
          <div role="group" aria-label="Model tier" className="flex flex-wrap gap-1.5">
            {TIERS.map((t) => (
              <button
                key={t.alias}
                type="button"
                onClick={() => setTier(t.alias)}
                aria-pressed={tier === t.alias}
                title={t.note}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-mono text-xs font-medium transition-colors",
                  tier === t.alias
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {t.alias}
              </button>
            ))}
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase hover:text-foreground"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? "− Hide" : "+ Show"} system prompt & temperature
          </button>
          {showAdvanced ? (
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">System prompt</span>
                <textarea
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  rows={2}
                  placeholder="Optional. Instructions the model follows for this call."
                  className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="flex items-center justify-between text-xs font-medium text-foreground">
                  Temperature
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {temperature.toFixed(1)}
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-foreground"
                />
              </label>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Prompt ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          rows={4}
          placeholder="Ask anything. ⌘↵ to send."
          className="w-full resize-y rounded-t-xl bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onPickImage(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden />
              {image ? "Image attached" : "Attach image"}
            </Button>
            {image ? (
              <button
                type="button"
                onClick={() => setImage(null)}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                remove
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {answer || usage ? (
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="size-4" aria-hidden />
                Clear
              </Button>
            ) : null}
            {streaming ? (
              <Button type="button" variant="outline" size="sm" onClick={stop}>
                <Square className="size-3.5" aria-hidden />
                Stop
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => void run()} disabled={!canRun}>
                <Play className="size-3.5" aria-hidden />
                Run
              </Button>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-sm leading-relaxed text-foreground">{error}</p>
        </div>
      ) : null}

      {/* ── Answer ───────────────────────────────────────────────── */}
      {answer || streaming ? (
        <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <p className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Answer · <span className="font-mono">{tier}</span>
          </p>
          <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {answer || <span className="text-muted-foreground">Thinking…</span>}
            {streaming ? (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-middle" />
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── Usage ────────────────────────────────────────────────── */}
      {usage ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Input tokens" value={usage.inputTokens?.toLocaleString() ?? "—"} />
          <Metric label="Output tokens" value={usage.outputTokens?.toLocaleString() ?? "—"} />
          <Metric
            label="Cost of this call"
            value={usage.costUsd != null ? `$${usage.costUsd.toFixed(6)}` : "—"}
            emphasis
          />
          <Metric
            label="Latency"
            value={usage.latencyMs != null ? `${(usage.latencyMs / 1000).toFixed(2)}s` : "—"}
          />
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        This is the same gateway, the same metering and the same limit as the
        API — nothing here is simulated. When your pool is spent you will see
        the same 403 an SDK would.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[10px] tracking-widest text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-sm tabular-nums",
          emphasis ? "font-semibold text-foreground" : "text-foreground/90",
        )}
      >
        {value}
      </p>
    </div>
  );
}
