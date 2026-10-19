import type { Metadata } from 'next';
import Navbar from '@/components/shadcn-space/blocks/hero-33/navbar';
import Hero33 from '@/components/shadcn-space/blocks/hero-33/hero';
import { LogoCloud } from '@/components/ui/logo-cloud-3';
import AnimatedBeamSection from '@/components/marketing/animated-beam-section';
import MacbookSection from '@/components/marketing/macbook-section';
import MobileSection from '@/components/marketing/mobile-section';
import PricingComponent from '@/components/ui/interactive-pricing-component';
import FaqSection from '@/components/marketing/faq-section';
import CTA from '@/components/shadcn-space/blocks/cta-01/cta';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Zaino AI — One API for Every Model',
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
const logos = [
  {
    src: "https://cdn.21st.dev/assets/mirror/bd/bdf5f3ae72bcfda892a686c03b7932985c694e9a9828643c980601bbc9e53cb4.svg",
    alt: "Nvidia Logo",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/31/319eeae853dd1af99d442b6c16b6c38dc52a66a719f8e502c65f85d26255cbd3.svg",
    alt: "Supabase Logo",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/2b/2bcdd4124223e3bf8e66bc08ce0ac32a6cc42ffe3584bbecfd377847176a188d.svg",
    alt: "OpenAI Logo",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/fc/fc7b090ebcfc468d24a1dc482b2db1fcbfd99ca14568552a30ce553d6dda7fcb.svg",
    alt: "Turso Logo",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/56/5624b7c243ac8d60e848fb5ea222ec932c1600df54a2762238b37498372fb0c8.svg",
    alt: "Vercel Logo",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/90/90f01a9537335666282ae5acc80bd4305f86d085a92d60904c3aa3ccc4414570.svg",
    alt: "GitHub Logo",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/e8/e8514b1206f79e1abdafcc1d2632393cc7cfbcbbe25426ac5143b17b184b56b8.svg",
    alt: "Claude AI Logo",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/96/96517bce3574d648280ff639d01d9889f354b488b3f826db5df746d730232a0c.svg",
    alt: "Clerk Logo",
  },
];

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main>
        <Hero33 />
        <section className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="mb-6 text-center font-medium text-foreground text-lg tracking-tight md:text-2xl">
            <span className="text-muted-foreground">Trusted by experts.</span>{" "}
            <span className="font-semibold">Used by the leaders.</span>
          </h2>
          <div className="mx-auto my-4 h-px max-w-sm bg-border [mask-image:linear-gradient(to_right,transparent,black,transparent)]" />
          <LogoCloud logos={logos} />
          <div className="mt-4 h-px bg-border [mask-image:linear-gradient(to_right,transparent,black,transparent)]" />
        </section>
        <AnimatedBeamSection />
        <MacbookSection />
        <MobileSection />
        <PricingComponent />
        <FaqSection />
        <CTA />
        <ZainoFooter />
      </main>
    </>
  );
}
