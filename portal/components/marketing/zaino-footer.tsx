'use client';

import { RuixenGradientFooter } from '@/components/ui/ruixen-gradient-footer';
import Logo from '@/assets/logo/logo';

const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Overview', href: '/' },
      { label: 'Pricing', href: '/#pricing' },
      { label: 'Docs', href: '/docs' },
      { label: 'API Reference', href: '/docs' },
      { label: 'Changelog', href: '/changelog' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'Guides', href: '/docs' },
      { label: 'Support', href: 'mailto:support@zaino.ai' },
      { label: 'Status', href: '#' },
      { label: 'Community', href: '#' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '#' },
      { label: 'Careers', href: '#' },
      { label: 'Blog', href: '#' },
      { label: 'Press', href: '#' },
      { label: 'Contact', href: 'mailto:hello@zaino.ai' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Security', href: '#' },
      { label: 'Cookies', href: '#' },
    ],
  },
];

export default function ZainoFooter() {
  return (
    <RuixenGradientFooter gradientHeight="40vh">
      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-16">
        <div className="grid gap-10 pb-10 sm:grid-cols-2 lg:grid-cols-6">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <Logo tone="light" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-black/70">
              Your ultimate Claude subscription — forget the limits. Licensed cloud infrastructure with direct Anthropic agreement, request-based billing, and D17 payment for Tunisia.
            </p>
            <div className="mt-6 flex max-w-xs gap-2">
              <input
                type="email"
                aria-label="Email address"
                placeholder="you@company.com"
                className="h-9 w-full rounded-md border border-black/20 bg-white/50 px-3 text-sm text-black placeholder:text-black/40 focus:border-black/40 focus:outline-none"
              />
              <button
                type="button"
                className="h-9 shrink-0 rounded-md bg-black px-3 text-xs font-semibold uppercase tracking-wider text-white transition-opacity hover:opacity-90"
              >
                Join
              </button>
            </div>
          </div>

          {/* Link columns */}
          <nav className="grid grid-cols-2 gap-10 text-xs uppercase tracking-wider sm:grid-cols-4 lg:col-span-4">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="font-semibold text-black">{col.title}</h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-black/60 transition-colors hover:text-black"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-black/10 pt-6 pb-2 text-xs uppercase tracking-wider text-black/50 sm:flex-row">
          <span>© 2026 Zaino AI</span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-emerald-600" />
            All systems normal
          </span>
          <span>Tunis · Remote</span>
        </div>
      </div>
    </RuixenGradientFooter>
  );
}