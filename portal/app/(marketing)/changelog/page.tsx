import type { Metadata } from 'next';
import Navbar from '@/components/shadcn-space/blocks/hero-33/navbar';
import ChangelogContent from '@/components/marketing/changelog-content';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Product Changelog',
  description:
    'Product updates, new features, and improvements across Zaino AI integrations and the desktop app.',
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Navbar tone="light" />
      <ChangelogContent />
      <ZainoFooter />
    </div>
  );
}