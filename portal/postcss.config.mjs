/**
 * PostCSS — Tailwind v4.
 *
 * v4 is a single PostCSS plugin and CSS-first configuration: no
 * tailwind.config.ts, no autoprefixer (v4 handles vendor prefixing),
 * and the theme lives in app/globals.css. The shadcn "base-nova"
 * preset and every registry component expect this setup — v3-only
 * variants (`bg-linear-to-*`, `has-data-[...]`) are native there.
 */

const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
