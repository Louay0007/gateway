/**
 * Account-domain error, shared by the pure validators and the service.
 *
 * Lives here — not in `service.ts` — so `lib/account/avatar.ts` can throw
 * it without importing the database client, which would drag `DATABASE_URL`
 * into every unit test that touches a pure rule. `service.ts` re-exports
 * it, so existing importers do not change.
 */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'validation'
      | 'not_found'
      | 'conflict'
      | 'upstream'
      | 'internal',
    readonly status: number,
    /** Field-level message, so a form can put it on the right input. */
    readonly field?: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}
