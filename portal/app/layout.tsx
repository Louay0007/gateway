/**
 * Root layout — the app shell every route inherits.
 *
 * Owns the three things that must exist exactly once: the document
 * (`<html>`/`<body>`), the font variables, and the global stylesheet.
 * Everything else is per-route-group (see `app/(marketing)` for the
 * public site, `app/(app)` for the signed-in product when it lands).
 */

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cn } from '@/lib/utils';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

/**
 * Inter, self-hosted by next/font (SIL OFL — safe to embed, no CDN
 * request, no layout shift).
 *
 * Why Inter and not Apple's SF Pro: SF Pro's licence forbids embedding
 * the font files in software or websites, so it cannot be shipped as a
 * web font. The stack in globals.css therefore puts `-apple-system`
 * FIRST — Apple visitors render the real SF Pro from their own system —
 * and Inter (the open, metrically-adjacent substitute designed for
 * exactly this) carries everyone else. The result is the SF Pro look
 * everywhere and Apple's own SF Pro on Apple devices, legally.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

/**
 * The viewport is declared rather than left to Next's default.
 *
 * `viewportFit: 'cover'` is what makes `env(safe-area-inset-*)` resolve to a
 * real value on a notched iPhone — without it the composer's bottom edge
 * sits under the home indicator. `interactiveWidget: 'resizes-content'`
 * makes the on-screen keyboard shrink the layout viewport instead of
 * overlaying it, which is what keeps the composer above the keyboard rather
 * than behind it.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://zaino.soon.it'),
  title: {
    default: 'Zaino AI — One API for Every Model',
    template: '%s | Zaino AI',
  },
  description:
    'A single OpenAI- and Anthropic-compatible API for every model, with usage-based limits, instant keys, and D17 payment for Tunisia.',
  // Icons come from this directory's file conventions — favicon.ico,
  // icon.png, apple-icon.png — which Next tags with the hash its route needs.
  // Do NOT add an `icons` key here: hand-writing `{ icon: '/icon', apple:
  // '/apple-icon' }` overrode those tags with extension-less paths that 404
  // in Next 16, so production served a broken favicon.
  openGraph: {
    title: 'Zaino AI — One API for Every Model',
    description:
      'A single OpenAI- and Anthropic-compatible API for every model, with usage-based limits and instant keys.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={inter.variable}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
