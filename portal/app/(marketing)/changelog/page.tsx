import type { Metadata } from 'next';
import SiteNav from '@/components/marketing/site-nav';
import ChangelogContent from '@/components/marketing/changelog-content';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Product Changelog',
  description:
    'Product updates, new features, and improvements across Zaino AI integrations and the desktop app.',
  // Advertise the feed so a reader (or a browser) discovers it without
  // being told the URL. This is the whole point of a changelog with RSS.
  alternates: {
    types: {
      'application/rss+xml': '/changelog.xml',
    },
  },
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <ChangelogContent />
      <ZainoFooter />
    </div>
  );
}