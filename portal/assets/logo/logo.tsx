import Image from "next/image";
import type { SVGAttributes } from "react";

/**
 * Brand lockup — the real Zaino mark (public/logo/zaino-curved-z-white.png)
 * on a black rounded tile, plus the wordmark "Zaino AI".
 *
 * Why the tile: the PNG is a WHITE glyph on TRANSPARENT background, so it
 * is invisible on light surfaces. Seating it on black reproduces the source
 * image (white-on-black) and reads in both themes. The tile stays black in
 * dark mode too — only the wordmark follows the theme.
 *
 * `tone="light"` pins the wordmark black for surfaces that are white in
 * BOTH themes (the auth pages) — otherwise `text-foreground` would render
 * white-on-white when the app theme is dark.
 *
 * `wordmark={false}` drops the text and keeps only the mark, for
 * icon-width surfaces (the collapsed sidebar rail, 3rem) where the
 * wordmark would overflow and clip.
 *
 * Single component used in the navbar (desktop top-left + mobile sheet)
 * and the auth shell.
 */
const Logo = ({
  tone = "auto",
  wordmark = true,
}: {
  tone?: "auto" | "light";
  wordmark?: boolean;
}) => {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black dark:ring-1 dark:ring-white/20">
        <Image
          src="/logo/zaino-curved-z-white.png"
          alt="Zaino AI logo"
          width={28}
          height={28}
          className="size-7 object-contain"
          priority
        />
      </span>
      {wordmark ? (
        <span
          className={
            tone === "light"
              ? "text-lg font-semibold tracking-tight text-black dark:text-white"
              : "text-lg font-semibold tracking-tight text-foreground"
          }
        >
          Zaino AI
        </span>
      ) : null}
    </span>
  );
};

export default Logo;
