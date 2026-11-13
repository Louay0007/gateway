"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

export function RedeemForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/trial/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setStatus("success");
        setMessage(data.message ?? "Trial activated!");
        // Refresh the page to show the active trial state
        setTimeout(() => router.refresh(), 1500);
      } else {
        setStatus("error");
        setMessage(data.error?.message ?? data.message ?? "Failed to redeem code.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="trial-code">Trial Code</Label>
        <Input
          id="trial-code"
          type="text"
          placeholder="e.g. ZAINO-FREE-NOV26"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          disabled={status === "loading" || status === "success"}
          className="font-mono uppercase tracking-wider"
          autoFocus
        />
      </div>

      {status === "error" && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive border-destructive/40 bg-destructive/10 text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {status === "success" && (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success border-success/30 bg-success/10 text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <Button
        type="submit"
        disabled={status === "loading" || status === "success" || !code.trim()}
        className="w-full bg-primary text-white hover:bg-muted hover:bg-primary/80"
      >
        {status === "loading" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Redeeming…
          </>
        ) : status === "success" ? (
          "Activated"
        ) : (
          "Redeem Code"
        )}
      </Button>
    </form>
  );
}