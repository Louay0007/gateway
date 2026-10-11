import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { organizations, organizationMembers, entitlements, usagePeriods } from '@/db/schema';
import { and, eq, desc, sql } from 'drizzle-orm';
import { listMemberships, userByEmail } from '@/lib/auth/authorize';
import { ensureSessionReady } from '@/lib/auth/provision';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };

/**
 * Customer dashboard — C-02 (Phase 1 slice).
 *
 * Phase 1 scope is the empty state: prove a new signup lands here with
 * $0 usage and a synced entitlement. The usage charts arrive in Phase 2,
 * keys in Phase 3.
 */
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect('/sign-in');

  // Await provisioning BEFORE reading memberships. Layout and page render
  // concurrently, so relying on the layout's provisioning alone races a
  // first-time user into a /sign-in redirect. See ensureSessionReady.
  const current = await userByEmail(session.user.email);
  if (current) await ensureSessionReady(current.id);

  const memberships = await listMemberships();
  if (memberships.length === 0) {
    // Provisioning runs in the layout; if we still have no org, something
    // failed. Send them somewhere honest rather than rendering $0 as if
    // it were real usage.
    redirect('/sign-in');
  }

  const orgId = memberships[0]!.orgId;
  const [org, entitlement] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }),
    db.query.entitlements.findFirst({ where: eq(entitlements.organizationId, orgId) }),
  ]);

  const period = currentPeriod();
  const rollup = await db.query.usagePeriods.findFirst({
    where: and(
      eq(usagePeriods.organizationId, orgId),
      eq(usagePeriods.billingPeriod, period.toISOString().slice(0, 10)),
    ),
  });

  const orgName = org?.name ?? 'Your organization';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{orgName}</h1>
          <p className="hint-text mt-1">
            Billing period {period.toISOString().slice(0, 10)}
          </p>
        </div>
        <PlanBadge planCode={entitlement?.planCode ?? 'free'} />
      </div>

      {/* Metric tiles. Always present, even at zero — an empty dashboard
          with no numbers reads as broken rather than new. */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Metric
          label="Spend this period"
          value={usd(rollup ? Number(rollup.costCustomerUsd) : 0)}
          hint="Billed at your plan rate"
        />
        <Metric
          label="Requests"
          value={String(rollup?.requests ?? 0)}
          hint="Across all keys"
        />
        <Metric
          label="Sync status"
          value={entitlement?.status ?? 'pending'}
          hint={entitlement?.lastError ?? 'Limits match your plan'}
        />
      </div>

      {memberships.length > 1 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-fg-muted">Your organizations</h2>
          <ul className="mt-2 space-y-1">
            {memberships.map((m) => (
              <li key={m.orgId} className="text-sm">
                {m.orgName} <span className="text-fg-subtle">· {m.role}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-medium text-fg-muted">Get started</h2>
        <div className="card mt-3 p-5">
          <p className="text-sm text-fg-muted">
            Create an API key to make your first request. Keys are scoped to
            your plan and stop automatically at the spend ceiling.
          </p>
          <a href="/dashboard/keys" className="btn-primary mt-4">
            Create an API key
          </a>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-2 text-metric tnum font-semibold">{value}</p>
      <p className="mt-1 text-xs text-fg-subtle">{hint}</p>
    </div>
  );
}

function PlanBadge({ planCode }: { planCode: string }) {
  return (
    <span className="rounded-full border border-[var(--edge)] px-3 py-1 text-xs
                     font-medium uppercase tracking-wide text-fg-muted">
      {planCode}
    </span>
  );
}

function usd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Billing period = first day of the current month (matches the rollup). */
function currentPeriod(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}