/**
 * Key health — the two facts a key table does not show by itself.
 *
 * WHY. "Never used" is how a customer finds the key they created, pasted
 * nowhere, and forgot about; "unused 30d" is how they find a credential that
 * should be revoked. Both are derivable from `KeyView.lastUsedAt`, which the
 * keys route already returns — this is a badge, not a feature.
 *
 * Note what is deliberately absent: an "expires in N days" badge. `KeyView`
 * carries `expiresAt` on the *gateway* payload but the portal's `KeyView`
 * does not expose it, so a countdown here would be invented rather than
 * read. Add the field to the contract first, then the badge.
 */
import type { KeyView } from '@/lib/keys/types';

export type KeyHealth = 'never-used' | 'stale' | 'healthy';

export interface KeyHealthInfo {
  state: KeyHealth;
  label: string | null;
  /** Why it reads that way — used as the badge's `title` for a tooltip. */
  hint: string | null;
}

/** A key untouched for this long is worth revoking rather than keeping. */
export const STALE_DAYS = 30;

export function keyHealth(key: Pick<KeyView, 'createdAt' | 'lastUsedAt'>, now: Date = new Date()): KeyHealthInfo {
  if (key.lastUsedAt) {
    const last = new Date(key.lastUsedAt).getTime();
    if (Number.isFinite(last)) {
      const days = (now.getTime() - last) / 86_400_000;
      if (days >= STALE_DAYS) {
        return {
          state: 'stale',
          label: `Unused ${Math.floor(days)}d`,
          hint: `No traffic on this key for ${Math.floor(days)} days — consider revoking it.`,
        };
      }
    }
    return { state: 'healthy', label: null, hint: null };
  }

  // Never used. A key minted a minute ago is not "forgotten"; only one that
  // has sat unused for a day earns the nudge, so a fresh key does not open
  // its own page with a warning.
  const created = new Date(key.createdAt).getTime();
  const ageDays = Number.isFinite(created) ? (now.getTime() - created) / 86_400_000 : 0;
  if (ageDays >= 1) {
    return {
      state: 'never-used',
      label: 'Never used',
      hint: 'This key has not made a request yet. If you have not pasted it anywhere, it can be revoked.',
    };
  }
  return { state: 'healthy', label: null, hint: null };
}
