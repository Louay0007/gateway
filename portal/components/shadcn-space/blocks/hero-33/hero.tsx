"use client";

/**
 * hero-33 (shadcn-space registry block) — CONTENT OWNED BY US.
 *
 * Halloween edition: the hero is a single full-bleed banner SVG
 * (public/images/halloween/hero-banner.svg) that carries the whole
 * composition. Served via a plain <img> — use `unoptimized` would need
 * dangerouslyAllowSVG in next.config, so we bypass the image pipeline
 * for this deliberately master-quality asset.
 */

const Hero33 = () => {
  return (
    <section
      id="hero"
      data-hero=""
      className="relative w-full overflow-hidden bg-[#000000]"
    >
      {/* Sit flush against the navbar's gradient (nav row ≈ 72px) so the
          banner merges homogeneously into it. */}
      <div className="relative z-10 flex items-center justify-center pt-[72px]">
        <img
          src="/images/halloween/hero-banner.svg"
          alt="Zaino AI — Let the Spooky Begin!"
          width={1920}
          height={1080}
          fetchPriority="high"
          className="w-full h-auto select-none"
        />
      </div>
      {/* Black fade so the artwork dissolves into the next section's bg */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[18%] bg-gradient-to-b from-black/0 to-black"
      />
    </section>
  );
};

export default Hero33;
