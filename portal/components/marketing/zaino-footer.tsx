'use client';

import { RuixenGradientFooter } from '@/components/ui/ruixen-gradient-footer';
import Logo from '@/assets/logo/logo';

const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Overview', href: '/' },
      { label: 'Desktop app', href: '/download' },
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
      { label: 'Support', href: 'mailto:contact.zaino.ai@gmail.com' },
      { label: 'WhatsApp', href: 'https://wa.me/21656794578' },
      { label: 'Status', href: '#' },
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
      { label: 'Call +216 56 794 578', href: 'tel:+21656794578' },
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
    <RuixenGradientFooter>
      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-16">
        <div className="grid gap-10 pb-10 sm:grid-cols-2 lg:grid-cols-6">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <Logo tone="auto" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-gray-600 dark:text-gray-400">
              Your ultimate Claude subscription — forget the limits. Licensed cloud infrastructure with direct Anthropic agreement, request-based billing, and D17 payment for Tunisia.
            </p>
            <div className="mt-6 flex max-w-xs gap-2">
              <input
                type="email"
                aria-label="Email address"
                placeholder="you@company.com"
                className="h-9 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-gray-900 dark:focus:border-gray-100 focus:outline-none"
              />
              <button
                type="button"
                className="h-9 shrink-0 rounded-md bg-gray-900 dark:bg-gray-700 px-3 text-xs font-semibold uppercase tracking-wider text-white transition-opacity hover:opacity-90"
              >
                Join
              </button>
            </div>
          </div>

          {/* Link columns */}
          <nav className="grid grid-cols-2 gap-10 text-xs uppercase tracking-wider sm:grid-cols-4 lg:col-span-4">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">{col.title}</h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-gray-500 dark:text-gray-400 transition-colors hover:text-gray-900 dark:hover:text-gray-100"
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
        <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-800 pt-6 pb-2 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 sm:flex-row">
          <span>© 2026 Zaino AI</span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            All systems normal
          </span>
          <span>Tunis · Remote</span>
        </div>
      </div>
    </RuixenGradientFooter>
  );
}