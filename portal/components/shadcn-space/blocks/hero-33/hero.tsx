import GlowHorizonFM from "@/components/ui/glow-horizon";
import Link from "next/link";

/**
 * The landing hero.
 *
 * The composition is live markup, not an image: a violet horizon glow, the
 * wordmark, and one call to action. The canvas is #050507 so the horizon's
 * black arc has something to blend into.
 */
export default function Hero33() {
  return (
    <section
      id="hero"
      data-hero=""
      className="relative w-full overflow-hidden bg-[#050507]"
    >
      {/* Extra bottom padding lifts the copy clear of the horizon arc, which
          rests across the middle of the section. */}
      <div className="relative z-10 flex min-h-[calc(100svh-72px)] flex-col items-center justify-center px-4 pt-[72px] pb-40 text-center">
        {/* Pushed down so the arc's crest sits below the copy instead of
            cutting across the headline. */}
        <div className="pointer-events-none absolute inset-0 translate-y-[26%] scale-x-[1.9] sm:scale-x-100">
          <GlowHorizonFM variant="top" />
        </div>

        <div className="relative z-10 flex max-w-3xl flex-col items-center">
          <h1 className="font-sans text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-8xl">
            Zaino AI
          </h1>

          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-white/60 sm:text-lg">
            One API for every model. OpenAI- and Anthropic-compatible
            endpoints, spend ceilings, and instant keys.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A558FB]"
            >
              Get an API key
            </Link>
            <Link
              href="/docs"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 px-7 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A558FB]"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </div>

      {/* Violet fade so the glow dissolves into the next section */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[18%] bg-gradient-to-b from-transparent to-[#050507]"
      />
    </section>
  );
}
