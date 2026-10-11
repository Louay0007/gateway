'use client';

import { useActionState } from 'react';
import { signUpAction, type SignUpState } from '@/lib/auth/signup-actions';

export default function SignUpForm() {
  const [state, formAction, pending] = useActionState<SignUpState, FormData>(
    signUpAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div>
        <label className="label" htmlFor="name">Name <span className="text-fg-subtle">(optional)</span></label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          className="input"
          maxLength={120}
        />
      </div>

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
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
        {state.fieldErrors?.email && (
          <p className="error-text mt-1.5">{state.fieldErrors.email}</p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="input"
          aria-describedby="password-hint"
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        <p id="password-hint" className="hint-text mt-1.5">
          At least 12 characters, mixing two of: lowercase, uppercase, numbers, symbols.
        </p>
        {state.fieldErrors?.password && (
          <p className="error-text mt-1.5">{state.fieldErrors.password}</p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="confirm">Confirm password</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className="input"
          aria-invalid={Boolean(state.fieldErrors?.confirm)}
        />
        {state.fieldErrors?.confirm && (
          <p className="error-text mt-1.5">{state.fieldErrors.confirm}</p>
        )}
      </div>

      {state.error && <p role="alert" className="error-text">{state.error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}