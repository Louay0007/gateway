"use client";

import * as React from "react";
import { useActionState } from "react";
import { Lock } from "lucide-react";

import { adminSignInAction, type AdminAuthFormState } from "@/lib/auth/admin-actions";
import { AuthField } from "@/components/auth/auth-fields";
import { AuthSubmitButton } from "@/components/auth/submit-button";

/**
 * The console login — two fields, and that is the whole brief.
 *
 * The form decides nothing: it posts FormData and renders whatever comes
 * back, matching `SignInForm`'s contract exactly. Failure copy never
 * distinguishes "no such username" from "wrong password" from "throttled" —
 * the backend already spends the same KDF on all three, so distinguishing
 * them in the UI would leak what the timing profile protects.
 *
 * NOT wrapped in `AuthShell`: that component carries the customer product's
 * branding, sign-up links and social buttons, none of which belong on a
 * staff console. Full-screen and self-contained, so it does not depend on
 * the console layout — which requires the session this page is here to
 * create.
 *
 * THEMED WITH TOKENS, not the light-only palette the deleted static gate
 * page hardcoded. That page used inline `#f3f4f6`/`#111827` with
 * `!important` because it had to survive the root layout's dark theme; this
 * one has no layout above it, so the ordinary tokens apply and the console
 * login follows the same theme as everything else.
 */
const INITIAL: AdminAuthFormState = {};

export function AdminSignInForm({
  next,
  signedOut,
}: {
  next: string;
  signedOut: boolean;
}) {
  const [state, action] = useActionState(adminSignInAction, INITIAL);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-card-foreground shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
            <Lock className="size-6 text-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Operations Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {signedOut
              ? "Signed out. Sign in again to continue."
              : "Sign in with your operations account."}
          </p>
        </div>

        <form action={action} className="space-y-4">
          <input type="hidden" name="next" value={next} />

          <AuthField
            id="username"
            name="username"
            label="Username"
            type="text"
            autoComplete="username"
            error={state.fieldErrors?.username}
          />

          <AuthField
            id="password"
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            error={state.fieldErrors?.password}
          />

          {state.error ? (
            <p role="alert" aria-live="assertive" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <AuthSubmitButton label="Sign in" pendingLabel="Signing in…" />
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          No console access? Ask an owner to grant it under Staff.
        </p>
      </div>
    </div>
  );
}
