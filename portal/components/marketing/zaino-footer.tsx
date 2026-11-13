'use client';

import { RuixenGradientFooter } from '@/components/ui/ruixen-gradient-footer';
import { Ambient } from "@/components/marketing/ambient";
import Logo from '@/assets/logo/logo';

/**
 * THE ONE FOOTER. This replaces a second implementation
 * (components/marketing/footer.tsx) that lived alongside it and pointed
 * Pricing at a different target — two footers is how a link rots in one
 * place and not the other.
 *
 * EVERY HREF HERE RESOLVES. The previous version linked Status, About,
 * Careers, Blog, Press, Security and Cookies to "#", and Pricing to
 * /#pricing (a section anchor that only exists on the landing hero). A
 * footer link that scrolls nowhere is worse than no link: it reads as a
 * company that stopped finishing things. Pages that do not exist yet are
 * simply absent until they do.
 */
const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Overview', href: '/' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Models', href: '/models' },
      { label: 'Playground', href: '/playground' },
      { label: 'Docs', href: '/docs' },
      { label: 'Desktop app', href: '/download' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'FAQ', href: '/faq' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'Connect your tool', href: '/connect' },
      { label: 'Support', href: 'mailto:contact.zaino.ai@gmail.com' },
      { label: 'Status', href: '/status' },
      { label: 'WhatsApp', href: 'https://wa.me/21656794578' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Contact', href: '/contact' },
      { label: 'Call +216 56 794 578', href: 'tel:+21656794578' },
      { label: 'Sign in', href: '/sign-in' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
];

export default function ZainoFooter() {
  return (
    <RuixenGradientFooter
      className="relative overflow-hidden bg-[#000000] dark:bg-[#000000]"
      style={{ backgroundColor: '#000000', backgroundImage: 'none' }}
    >
      <Ambient />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-16">
        <div className="grid gap-10 pb-10 sm:grid-cols-2 lg:grid-cols-6">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <Logo tone="auto" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-white/60">
              Your ultimate Claude subscription — forget the limits. Licensed cloud infrastructure with direct Anthropic agreement, request-based billing, and D17 payment for Tunisia.
            </p>
            <div className="mt-6 flex max-w-xs gap-2">
              <input
                type="email"
                aria-label="Email address"
                placeholder="you@company.com"
                className="h-9 w-full rounded-md border border-white/20 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 focus:border-[#A558FB] focus:outline-none"
              />
              <button
                type="button"
                className="h-9 shrink-0 rounded-md bg-white px-4 text-xs font-semibold text-black transition-opacity hover:opacity-90"
              >
                Join
              </button>
            </div>
          </div>

          {/* Link columns */}
          <nav className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-4 lg:col-span-4">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="font-semibold text-white">{col.title}</h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-white/50 transition-colors hover:text-[#A558FB]"
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
        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 pb-2 text-xs text-white/40 sm:flex-row">
          <span>© 2026 Zaino AI</span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-[#A558FB]" />
            All systems normal
          </span>
          <span>Tunis · Remote</span>
        </div>
      </div>
    </RuixenGradientFooter>
  );
}
