'use client';

import { RuixenGradientFooter } from '@/components/ui/ruixen-gradient-footer';
import { Ambient } from "@/components/marketing/ambient";
import Logo from '@/assets/logo/logo';
import { Button } from "@/components/ui/button";

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
    /*
     * `.mkt-on-dark` PINS THE DARK PALETTE FOR THIS SUBTREE.
     *
     * The footer is deliberately black in both themes — a black plinth under
     * a white page is a common and deliberate pattern (Stripe, Vercel) — and
     * it is shared by eleven routes. Pinning the tokens means a theme switch
     * on the landing page cannot restyle the footer of /docs, /pricing,
     * /terms and the rest, so this change stays where it was asked for.
     *
     * It also fixes a latent contrast bug: the wordmark used `tone="auto"`,
     * which resolves to `text-foreground`. On a light <html> that is
     * near-BLACK text on this near-black footer. Pinning `--mkt-ink` inside
     * the scope is what makes `tone="light"` (fixed black) unnecessary and
     * `tone="auto"` correct again — the token it reads is white here.
     */
    <RuixenGradientFooter
      className="mkt-on-dark relative overflow-hidden bg-mkt-bg"
    >
      <Ambient />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-16">
        <div className="grid gap-10 pb-10 sm:grid-cols-2 lg:grid-cols-6">
          {/* Brand column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <Logo tone="auto" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-mkt-muted">
              One key, one shared token pool per plan, and a meter you can audit. Built for developers in Tunisia and the Maghreb, payable by D17.
            </p>
            <div className="mt-6 flex max-w-xs gap-2">
              <input
                type="email"
                aria-label="Email address"
                placeholder="you@company.com"
                className="h-9 w-full rounded-md border border-mkt-line-strong bg-mkt-surface px-3 text-sm text-mkt-ink placeholder:text-mkt-faint focus:border-mkt-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-mkt-accent/40"
              />
              <Button
                type="button"
                size="sm"
                className="shrink-0 bg-mkt-ink text-mkt-bg hover:opacity-90 cursor-pointer"
              >
                Join
              </Button>
            </div>
          </div>

          {/* Link columns */}
          <nav className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-4 lg:col-span-4">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="font-semibold text-mkt-ink">{col.title}</h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-mkt-faint transition-colors hover:text-mkt-accent"
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
        <div className="flex flex-col items-center justify-between gap-3 border-t border-mkt-line pt-6 pb-2 text-xs text-mkt-faint sm:flex-row">
          <span>© 2026 Zaino AI</span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-mkt-accent" />
            All systems normal
          </span>
          <span>Tunis · Remote</span>
        </div>
      </div>
    </RuixenGradientFooter>
  );
}
