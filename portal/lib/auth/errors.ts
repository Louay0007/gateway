/**
 * AuthzError — the one error type authorization throws.
 *
 * Extracted from authorize.ts so that modules which need to THROW a 401/403
 * do not have to import authorize.ts. That module pulls in `next/navigation`
 * and `@/auth` (NextAuth), which the jobs/proof runner cannot resolve — a
 * script that imports `verify-email.ts` (which throws a 403 for an
 * unverified account) must not drag the whole Next runtime in behind it.
 *
 * authorize.ts re-exports this, so every existing
 * `import { AuthzError } from '@/lib/auth/authorize'` keeps working.
 */

export class AuthzError extends Error {
  constructor(
    message: string,
    readonly code: 'unauthorized' | 'forbidden' | 'not_found',
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthzError';
  }
}
