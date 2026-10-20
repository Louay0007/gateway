"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type AuthFormState } from "@/lib/auth/actions";
import { AuthField } from "@/components/auth/auth-fields";
import { AuthSubmitButton } from "@/components/auth/submit-button";

/**
 * SignInForm — email + password, nothing else.
 *
 * Data contract (matches signInAction in lib/auth/actions.ts):
 *   form fields: email, password, callbackUrl (hidden)
 *   returns: { fieldErrors?: { email?, password? }, error?: string }
 * The form decides nothing: it posts FormData, renders what comes back.
 * Generic failure copy is intentional — the backend never distinguishes
 * "no such account" from "wrong password" (enumeration defence).
 */
const INITIAL: AuthFormState = {};

export function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action] = useActionState(signInAction, INITIAL);
  return (
    <form action={action} className="space-y-5" noValidate={false}>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        error={state.fieldErrors?.email}
      />
      <div>
        <AuthField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={state.fieldErrors?.password}
        />
        <div className="mt-2 min-h-11 text-right">
          <Link
            href="/reset-password"
            className="inline-flex min-h-11 items-center rounded text-sm text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline dark:text-gray-400 dark:hover:text-gray-100 focus-visible:ring-2 focus-visible:ring-gray-900/40 dark:focus-visible:ring-gray-100/40 focus-visible:outline-none"
          >
            Forgot password?
          </Link>
        </div>
      </div>
      {state.error ? (
        <p role="alert" aria-live="assertive" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <AuthSubmitButton label="Sign in" pendingLabel="Signing in…" />
    </form>
  );
}
