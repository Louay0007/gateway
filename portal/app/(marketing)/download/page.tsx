import type { Metadata } from 'next';
import SiteNav from '@/components/marketing/site-nav';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Zaino Agent CLI — Coming Soon',
  description: 'The Zaino Agent CLI is in development. Check back shortly.',
};

export default function DownloadPage() {
  return (
    <div className="flex min-h-screen flex-col bg-black text-foreground">
      <SiteNav active="Download" />
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Coming soon
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Zaino Agent CLI
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
            One command to put the gateway in your terminal. In development.
          </p>
        </div>
      </main>
      <ZainoFooter />
    </div>
  );
}
