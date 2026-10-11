export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team' };

/**
 * Placeholder for the team surface. Implemented in the phase that owns it
 * per IMPLEMENTATION.md §7:
 *   usage   -> Phase 2 (usage explorer + cache-savings banner)
 *   keys    -> Phase 3 (C-05: create/revoke, plaintext shown once)
 *   team    -> Phase 4 (C-06: invite + roles)
 *   billing -> Phase 6 (C-07: Stripe checkout + invoices)
 *   settings-> Phase 1 follow-on (C-09: org name/slug)
 *
 * Deliberately read-only so no route ever 500s while the surface is
 * still being built.
 */
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Team</h1>
      <p className="hint-text mt-2">Coming in a later phase.</p>
    </div>
  );
}
