import GlowHorizonFM from "@/components/ui/glow-horizon";
import Link from "next/link";

/**
 * The landing hero.
 *
 * Halloween edition: the 18MB banner SVG is gone. The composition is now
 * live markup — a glow horizon, the headline, and one call to action —
 * which is a few KB of HTML instead of an image the browser has to fetch
 * and decode before it can paint anything.
 *
 * The dark canvas is #050507 rather than the section background so the
 * horizon's black arc has something to blend into.
 */
export default function Hero33() {
  return (
    <section
      id="hero"
      data-hero=""
      className="relative w-full overflow-hidden bg-[#050507]"
    >
      <div className="relative z-10 flex min-h-[calc(100svh-72px)] flex-col items-center justify-center px-4 pt-[72px] pb-16 text-center">
        <GlowHorizonFM variant="top" />

        <div className="relative z-10 flex max-w-3xl flex-col items-center">
          <span className="mb-6 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-white/70 sm:text-sm">
            31 October — Halloween Edition
          </span>

          <h1 className="font-sans text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-8xl">
            Zaino AI
          </h1>

          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-white/60 sm:text-lg">
            Laughing through the shadows — one API for every model.
            OpenAI- and Anthropic-compatible endpoints, spend ceilings, and
            instant keys.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-semibold text-black transition-colors hover:bg-white/90"
            >
              Get an API key
            </Link>
            <Link
              href="/docs"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 px-7 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </div>

      {/* Black fade so the glow dissolves into the next section's bg */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[18%] bg-gradient-to-b from-black/0 to-black"
      />
    </section>
  );
}
