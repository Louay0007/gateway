'use client';

import { useActionState } from 'react';
import { signInAction, type AuthFormState } from '@/lib/auth/actions';

/**
 * Credentials form.
 *
 * A client component only because it needs `useActionState` for pending
 * and error state. The actual verification happens server-side in the
 * Auth.js authorize callback — nothing here decides whether a login
 * succeeds.
 */
export default function SignInForm({ callbackUrl = '/dashboard' }: { callbackUrl?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signInAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <div>
        <label className="label" htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="input"
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
        {state.fieldErrors?.email && (
          <p id="email-error" className="error-text mt-1.5">{state.fieldErrors.email}</p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          aria-describedby={state.fieldErrors?.password ? 'password-error' : undefined}
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        {state.fieldErrors?.password && (
          <p id="password-error" className="error-text mt-1.5">{state.fieldErrors.password}</p>
        )}
      </div>

      {state.error && (
        <p role="alert" className="error-text">{state.error}</p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}