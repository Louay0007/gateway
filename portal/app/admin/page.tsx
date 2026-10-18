"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Lock } from "lucide-react";

/**
 * Admin gate — secret-code entry to the operations console.
 *
 * This is the FIRST thing anyone sees at /admin. The IP allowlist in
 * Caddy stops strangers; this stops anyone who has network access but
 * not the shared secret. After a correct code the API mints an httpOnly
 * cookie scoped to /admin, and the layout's server-side check lets the
 * request through to the real console.
 *
 * The secret is `zainadmin` (set via ADMIN_GATE_SECRET on the server).
 * It is never stored in client code — the form POSTs to the gate API
 * which compares server-side and sets the cookie only on success.
 */
export default function AdminGatePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Invalid code");
        return;
      }

      // Cookie is set by the server response. Navigate to the real console.
      router.push("/admin/ops");
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Lock className="size-5 text-primary" />
          </div>
          <CardTitle className="text-lg">Operations Console</CardTitle>
          <CardDescription>Enter the access code to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gate-code">Access code</Label>
              <Input
                id="gate-code"
                type="password"
                autoComplete="off"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" disabled={!code || loading}>
              {loading ? "Verifying…" : "Enter console"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}