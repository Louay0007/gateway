import type { Metadata } from 'next';
import Navbar from '@/components/shadcn-space/blocks/hero-33/navbar';
import DownloadContent from '@/components/marketing/download-content';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Download Zaino AI Agent',
  description:
    'Zaino AI Agent — the official desktop client for the Zaino Gateway. macOS, Windows, and Linux.',
};

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-black pb-16 text-gray-100">
      <Navbar active="Download" />
      <DownloadContent />
      <ZainoFooter />
    </div>
  );
}
