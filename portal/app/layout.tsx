import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Gateway — fast, smart, frontier',
    template: '%s · Gateway',
  },
  description:
    'Scoped API keys for three model classes with spend ceilings, usage dashboards, and billing.',
  // The portal is an authenticated application; it should not be indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)',  color: '#0b1120' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}