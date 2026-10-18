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
    <main className="flex min-h-dvh items-center justify-center px-4 bg-white dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-lg">
        <div className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950">
            <Lock className="size-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Operations Console</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Enter the access code to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="gate-code" className="text-sm font-medium text-gray-700 dark:text-gray-300">Access code</label>
            <input
              id="gate-code"
              type="password"
              autoComplete="off"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              className="h-10 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!code || loading}
            className="h-10 w-full rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Verifying…" : "Enter console"}
          </button>
        </form>
      </div>
    </main>
  );
}