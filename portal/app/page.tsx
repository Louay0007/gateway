import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Three model classes.{' '}
          <span className="text-[var(--accent)]">One base URL.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-fg-muted">
          Scoped API keys with hard spend ceilings, usage you can actually
          reconcile, and billing that matches your token counts.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/sign-up" className="btn-primary">Get started</Link>
          <Link href="/pricing" className="btn-secondary">Pricing</Link>
        </div>
      </div>
    </main>
  );
}