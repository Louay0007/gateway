import type { Metadata } from 'next';
import Navbar from '@/components/shadcn-space/blocks/hero-33/navbar';
import DownloadContent from '@/components/marketing/download-content';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Download Zaino AI Agent',
  description:
    'Native desktop app for macOS, Windows, and Linux. Fast on Sonnet 5, Smart on Opus 5.5 — your gateway models on every machine.',
};

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-white text-black">
      <Navbar tone="light" active="Download" />
      <DownloadContent />
      <ZainoFooter />
    </div>
  );
}
