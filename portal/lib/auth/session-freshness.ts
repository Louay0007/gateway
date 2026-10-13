/**
 * Session freshness — pure, zero infrastructure.
 *
 * Split out of `lib/auth/authorize.ts` for the same reason
 * `lib/auth/reset-tokens.ts` is separate from `reset.ts`: importing
 * `authorize.ts` pulls in `@/db`, which throws in any environment without a
 * database — including the unit-test runner. A rule that decides whether a
 * stolen cookie still works must be testable without standing one up.
 *
 * WHAT THIS DECIDES. Auth.js v5 permits the Credentials provider only with
 * the JWT strategy, so a session is a self-contained token and cannot be
 * revoked by deleting a row. A password change therefore cannot "log
 * everyone out" the ordinary way. What it CAN do is move a timestamp:
 * `users.password_changed_at` is stamped on every credential change and
 * copied into the token at sign-in, and a token older than the stamp is
 * refused on its next request.
 *
 * That is strictly stronger than deleting a session row: a row can be
 * deleted before an attacker ever presents the cookie, whereas the stamp
 * comparison catches a token that was never in the table.
 */

/**
 * Is this session still valid for the stored credential?
 *
 * Compared as epoch milliseconds, never as text: Postgres keeps
 * microsecond precision and the JWT keeps milliseconds, so the two
 * representations of the same instant can differ character-for-character.
 * Textual equality would reject a token issued in the same millisecond as
 * the change — a spurious logout on every password change.
 *
 * FAILS CLOSED in every ambiguous case. An unparseable stamp cannot prove
 * freshness, so it is refused. The asymmetry is deliberate: a false accept
 * leaves a compromised account alive, a false reject costs one sign-in.
 *
 * A missing ROW is the one case that accepts, because there is nothing to
 * invalidate against — a user row that does not exist cannot be compared
 * to anything.
 */
export function sessionIsFresh(
  tokenStamp: string | null | undefined,
  rowStamp: Date | null | undefined,
): boolean {
  if (!rowStamp) return true;
  if (!tokenStamp) return false;

  const token = Date.parse(tokenStamp);
  if (Number.isNaN(token)) return false;

  return token >= rowStamp.getTime();
}