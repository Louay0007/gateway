import type { Metadata } from 'next';
import SiteNav from '@/components/marketing/site-nav';
import { Ambient } from '@/components/marketing/ambient';
import Hero33 from '@/components/shadcn-space/blocks/hero-33/hero';
import { LogoCloud } from '@/components/ui/logo-cloud-3';
import AnimatedBeamSection from '@/components/marketing/animated-beam-section';
import DevicesSection from '@/components/marketing/devices-section';
import PricingComponent from '@/components/ui/interactive-pricing-component';
import FaqSection from '@/components/marketing/faq-section';
import CTA from '@/components/shadcn-space/blocks/cta-01/cta';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Zaino AI — One API for Every Model',
  description:
    'OpenAI- and Anthropic-compatible endpoints with spend ceilings, instant keys, and D17 payment.',
};

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

/**
 * Force dark mode on the landing page only.
 *
 * Runs before first paint so the Sections below never flash a light theme
 * over a black canvas. Other marketing routes respect the saved preference.
 */
const forceDarkScript = `
(function(){
  var h = document.documentElement;
  h.classList.remove('light');
  h.classList.add('dark');
  try { localStorage.setItem('theme', 'dark'); } catch(e){}
})();
`;

/**
 * The landing page.
 *
 * The landing page is the front door for EVERYONE, signed in or not. It
 * used to redirect a live session to /chat, which meant a returning
 * customer could never see the site they were paying for, and the root URL
 * had no stable public meaning. The way into the product is the navbar's
 * "Open chat" button plus the account avatar; no redirect.
 */
export default function LandingPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: forceDarkScript }} />
      <div className="dark bg-[#050507] text-white">
        <SiteNav tone="light" />
        <main className="bg-[#050507]">
          <Hero33 />

          <section className="relative overflow-hidden px-4 py-16 sm:px-6 lg:px-8">
            <Ambient />
            <div className="mx-auto max-w-7xl">
              <p className="mx-auto max-w-md text-center text-sm text-white/50">
                Trusted by people shipping with models from
              </p>
              <div className="mt-6">
                <LogoCloud logos={logos} />
              </div>
            </div>
          </section>

          <AnimatedBeamSection />
          <DevicesSection />
          <PricingComponent />
          <FaqSection />
          <CTA />
          <ZainoFooter />
        </main>
      </div>
    </>
  );
}
