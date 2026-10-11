/**
 * PostCSS configuration.
 *
 * Required for Tailwind to actually process `@tailwind` directives. Without
 * this file Next.js runs PostCSS with its defaults, leaves the directives
 * unprocessed, and every utility class silently renders as nothing.
 *
 * Tailwind is pinned to 3.x — that is the PostCSS plugin line. Tailwind v4
 * uses a different, Vite-native pipeline and would need this file removed.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};