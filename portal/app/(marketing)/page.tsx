import type { Metadata } from 'next';
import Navbar from '@/components/shadcn-space/blocks/hero-33/navbar';
import Hero33 from '@/components/shadcn-space/blocks/hero-33/hero';

export const metadata: Metadata = {
  title: 'One API for every model, priced for the way Tunisia pays',
  description:
    'OpenAI- and Anthropic-compatible API endpoints with spend ceilings that hold, instant keys, and D17 payment for Tunisia.',
};

/**
 * The landing page — hero only (plus navbar).
 *
 * Features, pricing preview, and footer sections removed per request;
 * their components stay in components/marketing/** untouched, ready to
 * be re-mounted here whenever the full page comes back.
 *
 * Route group `(marketing)` keeps this and the future /pricing, /docs
 * and /legal pages on their own branch of the tree, ready for a shared
 * marketing layout without ever touching the signed-in product.
 */
export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main className="light-surface">
        <Hero33 />
      </main>
    </>
  );
}
