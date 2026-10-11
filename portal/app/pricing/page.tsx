import { db } from '@/db';
import { plans } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pricing' };

/**
 * Pricing — rendered from `plans` where public = true.
 *
 * The catalog is the single source of entitlement truth (PLATFORM.md
 * §3.3), so the page has no hardcoded plan list. If an admin edits a
 * plan, this page changes with it.
 */
export default async function PricingPage() {
  const catalog = await db
    .select()
    .from(plans)
    .where(eq(plans.public, true))
    .orderBy(asc(plans.sortOrder));

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Pricing</h1>
        <p className="mx-auto mt-3 max-w-lg text-fg-muted">
          Included usage is denominated in upstream token spend. Overage
          bills at your plan rate; you are never charged a surprise.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {catalog.map((plan) => (
          <div key={plan.id} className="card flex flex-col p-6">
            <h2 className="font-semibold">{plan.name}</h2>
            {plan.description && (
              <p className="mt-1 text-sm text-fg-muted">{plan.description}</p>
            )}

            <p className="mt-4 text-3xl font-semibold tnum">
              ${(plan.priceCents / 100).toLocaleString('en-US')}
              <span className="text-sm font-normal text-fg-subtle">/{plan.interval}</span>
            </p>

            <dl className="mt-4 space-y-1.5 text-sm">
              <Row
                label="Included spend"
                value={plan.includedSpendCents > 0
                  ? `$${(plan.includedSpendCents / 100).toLocaleString('en-US')}`
                  : '—'}
              />
              <Row
                label="Hard cap"
                value={plan.hardCapCents != null
                  ? `$${(plan.hardCapCents / 100).toLocaleString('en-US')}`
                  : 'Unlimited'}
              />
              <Row label="Models" value={plan.models.join(', ') || '—'} />
              <Row label="API keys" value={String(plan.maxKeys)} />
              <Row label="Seats" value={String(plan.maxSeats)} />
            </dl>

            <div className="mt-6 flex-1" />
            <Link href="/sign-up" className="btn-secondary w-full">
              {plan.priceCents > 0 ? 'Start free, upgrade later' : 'Get started'}
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-12 text-center text-sm text-fg-muted">
        Usage-based charges are non-refundable once consumed.
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  );
}