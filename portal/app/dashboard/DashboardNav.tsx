import Link from 'next/link';
import { signOutAction } from '@/lib/auth/actions';

const NAV = [
  { href: '/dashboard',        label: 'Overview' },
  { href: '/dashboard/usage',  label: 'Usage' },
  { href: '/dashboard/keys',   label: 'API keys' },
  { href: '/dashboard/team',   label: 'Team' },
  { href: '/dashboard/billing',label: 'Billing' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export default function DashboardNav({
  email,
  name,
}: {
  email: string;
  name?: string;
}) {
  return (
    <header className="border-b border-[var(--edge)] bg-[var(--surface-raised)]">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          Gateway
        </Link>

        <nav className="hidden gap-1 sm:flex" aria-label="Dashboard">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-fg-muted
                         hover:bg-[var(--surface-sunken)] hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{name ?? 'Account'}</p>
            <p className="text-xs text-fg-subtle leading-tight">{email}</p>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="btn-secondary">Sign out</button>
          </form>
        </div>
      </div>

      {/* Horizontal scroller keeps the nav reachable on small screens
          without hiding it behind a hamburger. */}
      <div className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2 sm:hidden">
        <nav className="flex gap-1" aria-label="Dashboard">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-fg-muted
                         hover:bg-[var(--surface-sunken)] hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}