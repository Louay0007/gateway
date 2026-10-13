"use client";

import { useActionState, useState } from "react";
import { signUpAction, type SignUpState } from "@/lib/auth/signup-actions";
import { AuthField } from "@/components/auth/auth-fields";
import { AuthSubmitButton } from "@/components/auth/submit-button";
import { PasswordChecklist } from "@/components/auth/password-checklist";

/**
 * SignUpForm — name (optional) + email + password + confirm.
 *
 * Data contract (matches signUpAction in lib/auth/signup-actions.ts):
 *   form fields: name, email, password, confirm
 *   returns: { fieldErrors?: { email?, password?, confirm? }, error?: string }
 * The live PasswordChecklist mirrors validatePassword() in
 * lib/auth/password.ts — hint only, the server is the authority.
 */
const INITIAL: SignUpState = {};

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, INITIAL);
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="space-y-5">
      <AuthField
        id="name"
        name="name"
        label="Name (optional)"
        type="text"
        autoComplete="name"
      />
      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        error={state.fieldErrors?.email}
      />
      <AuthField
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.password}
        describedBy="password-hint"
        onChange={setPassword}
      />
      <PasswordChecklist password={password} />
      <AuthField
        id="confirm"
        name="confirm"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.confirm}
      />
      {state.error ? (
        <p role="alert" aria-live="assertive" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <AuthSubmitButton label="Create account" pendingLabel="Creating account\u2026" />
    </form>
  );
}
