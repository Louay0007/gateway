import Image from "next/image";
import type { SVGAttributes } from "react";

/**
 * Brand lockup — the real Zaino mark plus the "Zaino AI" wordmark.
 *
 * THE MARK. `public/logo/zaino-curved-z-white.png` is a WHITE glyph on a
 * TRANSPARENT ground (256×256). White-on-transparent is invisible on any
 * light surface, so it must be seated on a ground. The ground is a deep
 * graphite tile with a hairline top-light — a real material rather than a
 * flat `bg-black` square, which reads as a placeholder swatch at 32px.
 * The tile stays dark in BOTH themes: the glyph is white, and inverting it
 * for light mode would mean shipping a second asset and a second optical
 * alignment for the same mark.
 *
 * WHY A CSS GRADIENT AND NOT A NEW PNG. The mark is the asset we were
 * given; the ground is chrome. Painting it in CSS keeps the logo crisp at
 * every density (the PNG is 256px, so `sizes` never upscales past 2× at
 * the sizes we use) and lets the tile pick up the theme's own hairline
 * without a second export.
 *
 * SIZES. `sm` (28px tile) is the sidebar rail and the collapsed state;
 * `md` (32px) is the default lockup. Both keep the glyph at ~62% of the
 * tile, which is the optical weight a single-glyph mark needs — a glyph
 * at 90% of its tile looks cramped and clips its curves at small sizes.
 */
const SIZES = {
  sm: { tile: "size-7 rounded-[7px]", glyph: 18, text: "text-[15px]" },
  md: { tile: "size-8 rounded-lg", glyph: 20, text: "text-base" },
} as const;

const Logo = ({
  tone = "auto",
  wordmark = true,
  size = "md",
  className,
}: {
  /** `light` pins the wordmark dark for surfaces that are white in both themes. */
  tone?: "auto" | "light";
  /** `false` keeps only the mark — for icon-width surfaces. */
  wordmark?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) => {
  const s = SIZES[size];

  return (
    <span className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-[linear-gradient(160deg,#2a2a2e_0%,#131315_58%,#0a0a0b_100%)] ring-1 ring-black/40 ring-inset dark:ring-white/15 ${s.tile}`}
        aria-hidden={wordmark ? true : undefined}
      >
        {/* A single specular line along the top edge. One authored detail
            is what separates a rendered tile from a flat swatch. */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/22" />
        <Image
          src="/logo/zaino-curved-z-white.png"
          alt={wordmark ? "" : "Zaino AI"}
          width={s.glyph}
          height={s.glyph}
          className="relative object-contain"
          priority
        />
      </span>
      {wordmark ? (
        <span
          className={`font-semibold tracking-[-0.02em] ${
            tone === "light" ? "text-black dark:text-white" : "text-foreground"
          } ${s.text}`}
        >
          Zaino<span className="text-muted-foreground"> AI</span>
        </span>
      ) : null}
    </span>
  );
};

export default Logo;
