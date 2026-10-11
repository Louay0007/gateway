import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Neutral surface palette. Kept small on purpose — the dashboard's
        // job is dense numeric tables, not decoration.
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          sunken: 'var(--surface-sunken)',
        },
        edge: 'var(--edge)',
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          subtle: 'var(--fg-subtle)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          fg: 'var(--accent-fg)',
        },
        // Usage/quota states. `warn` and `danger` are reserved for spend
        // pressure, never decoration.
        ok:    'var(--ok)',
        warn:  'var(--warn)',
        danger:'var(--danger)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Tabular figures on every numeric cell so columns align. Applied
        // via the `.tnum` utility in globals.css rather than here — the
        // Tailwind type only allows lineHeight/letterSpacing/fontWeight.
        metric: ['1.5rem', { lineHeight: '2rem' }],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: { 'fade-in': 'fade-in 120ms ease-out' },

      // Applied to every metric tile and numeric table cell so spend and
      // token columns line up vertically.
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
    },
  },
  plugins: [],
};

export default config;