/**
 * The chat meter's arithmetic, kept out of the component so it can be
 * checked without a renderer.
 *
 * The wall (`getAllowedModels`) reports what is LEFT, not what was used.
 * Reading the remainder as usage shows a brand-new account as 100% spent,
 * which is the kind of wrong that looks like a billing bug and is not.
 */
export function quotaPercent(limit?: number, remaining?: number): number | null {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return null;
  const left = Math.max(0, remaining ?? 0);
  // Both ends need clamping: a plan downgrade mid-period leaves the
  // remainder ABOVE the new limit, and `limit - left` goes negative. That
  // renders as a bar with a negative width and a "-400%" label.
  const used = Math.min(limit, Math.max(0, limit - left));
  return Math.min(100, Math.round((used / limit) * 100));
}
