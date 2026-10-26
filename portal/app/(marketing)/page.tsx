import type { Metadata } from 'next';
import Navbar from '@/components/shadcn-space/blocks/hero-33/navbar';
import Hero33 from '@/components/shadcn-space/blocks/hero-33/hero';
import { LogoCloud } from '@/components/ui/logo-cloud-3';
import { HalloweenDots } from '@/components/marketing/halloween-dots';
import AnimatedBeamSection from '@/components/marketing/animated-beam-section';
import MacbookSection from '@/components/marketing/macbook-section';
import MobileSection from '@/components/marketing/mobile-section';
import PricingComponent from '@/components/ui/interactive-pricing-component';
import FaqSection from '@/components/marketing/faq-section';
import CTA from '@/components/shadcn-space/blocks/cta-01/cta';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Zaino AI — Halloween Edition 🎃',
  description:
    'Spooky fast API access: OpenAI- and Anthropic-compatible endpoints with spend ceilings, instant keys, D17 payment, and a haunted discount this Halloween.',
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

/**
 * Force dark Halloween mode on the landing page only.
 *
 * This inline script runs before first paint to strip `light` from <html>
 * and set `dark`, ensuring the Halloween sections (bg #000000) always
 * render with light text regardless of the visitor's saved theme
 * preference. Other marketing routes (docs, download, pricing, etc.)
 * respect the user's theme through the root ThemeProvider.
 */
const forceDarkScript = `
(function(){
  var h = document.documentElement;
  h.classList.remove('light');
  h.classList.add('dark');
  try { localStorage.setItem('theme', 'dark'); } catch(e){}
})();
`;

export default function LandingPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: forceDarkScript }} />
      <div className="dark bg-[#000000] text-white">
        <Navbar tone="light" />
        <main className="bg-[#000000]">
        <Hero33 />
        <section className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 overflow-hidden">
          {/* Halloween ambient background */}
          <div aria-hidden="true" className="absolute inset-0 -z-10 pointer-events-none">
            <div className="absolute inset-0 bg-[#000000]" />
            <img src="/images/halloween/shape-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-soft-light opacity-30" />
            <div className="absolute top-1/4 left-[10%] w-72 h-72 rounded-full bg-orange-500/10 blur-[80px] animate-[pulse_9s_ease-in-out_infinite]" />
            <div className="absolute bottom-1/4 right-[10%] w-64 h-64 rounded-full bg-purple-500/10 blur-[80px] animate-[pulse_11s_ease-in-out_infinite_reverse]" />
            <HalloweenDots />
          </div>
          <img src="/images/halloween/item-witch-hat.png" alt="" aria-hidden="true" className="absolute -top-4 right-[12%] w-20 sm:w-28 md:w-32 h-auto opacity-90 pointer-events-none select-none rotate-6" />
          <img src="/images/halloween/item-pumpkin.png" alt="" aria-hidden="true" className="absolute -bottom-2 left-[10%] w-20 sm:w-28 md:w-32 h-auto opacity-90 pointer-events-none select-none -rotate-6" />
          <h2 className="mb-6 text-center font-medium text-white text-lg tracking-tight md:text-2xl">
            <span className="text-white/60">Trusted by experts.</span>{" "}
            <span className="font-semibold text-white">Used by the leaders.</span>
          </h2>
          <div className="mx-auto my-4 h-px max-w-sm bg-white/10 [mask-image:linear-gradient(to_right,transparent,black,transparent)]" />
          <LogoCloud logos={logos} />
          <div className="mt-4 h-px bg-white/10 [mask-image:linear-gradient(to_right,transparent,black,transparent)]" />
        </section>
        <AnimatedBeamSection />
        <MacbookSection />
        <MobileSection />
        <PricingComponent />
        <FaqSection />
        <CTA />
        <ZainoFooter />
      </main>
      </div>
    </>
  );
}
