'use client';

import { RuixenGradientFooter } from '@/components/ui/ruixen-gradient-footer';
import { HalloweenDots } from "@/components/marketing/halloween-dots";
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
    <RuixenGradientFooter
      className="relative overflow-hidden bg-[#000000] dark:bg-[#000000]"
      style={{ backgroundColor: '#000000', backgroundImage: 'none' }}
    >
      {/* Halloween ambient background */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-[#000000]" />
        <img src="/images/halloween/shape-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-soft-light opacity-30" />
        <img src="/images/halloween/footer-tree1.png" alt="" className="absolute bottom-0 right-0 w-56 sm:w-72 h-auto opacity-80 pointer-events-none" />
        <img src="/images/halloween/footer-tree2.png" alt="" className="absolute bottom-0 left-0 w-56 sm:w-72 h-auto opacity-80 pointer-events-none" />
        <div className="absolute top-1/4 left-[5%] w-64 h-64 rounded-full bg-purple-500/8 blur-[80px] animate-[pulse_10s_ease-in-out_infinite]" />
        <HalloweenDots />
      </div>
      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-16">
        <div className="grid gap-10 pb-10 sm:grid-cols-2 lg:grid-cols-6">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <Logo tone="auto" />
              <img src="/images/halloween/logo-skull.png" alt="" aria-hidden="true" className="w-14 h-14 object-contain opacity-90" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-white/60">
              Your ultimate Claude subscription — forget the limits. Licensed cloud infrastructure with direct Anthropic agreement, request-based billing, and D17 payment for Tunisia.
            </p>
            <div className="mt-6 flex max-w-xs gap-2">
              <input
                type="email"
                aria-label="Email address"
                placeholder="you@company.com"
                className="h-9 w-full rounded-md border border-white/20 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 focus:border-orange-500 focus:outline-none"
              />
              <button
                type="button"
                className="h-9 shrink-0 rounded-md bg-gradient-to-r from-orange-500 to-purple-600 px-3 text-xs font-semibold uppercase tracking-wider text-white transition-opacity hover:opacity-90"
              >
                Join
              </button>
            </div>
          </div>

          {/* Link columns */}
          <nav className="grid grid-cols-2 gap-10 text-xs uppercase tracking-wider sm:grid-cols-4 lg:col-span-4">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="font-semibold text-white">{col.title}</h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-white/50 transition-colors hover:text-orange-400"
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
        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 pb-2 text-xs uppercase tracking-wider text-white/40 sm:flex-row">
          <span>© 2026 Zaino AI</span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-orange-500" />
            All systems normal
          </span>
          <span>Tunis · Remote</span>
        </div>
      </div>
    </RuixenGradientFooter>
  );
}
