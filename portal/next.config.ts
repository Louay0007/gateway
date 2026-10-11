/**
 * Next.js configuration.
 *
 * `output: 'standalone'` produces a minimal server bundle for the
 * Dockerfile (IMPLEMENTATION.md §5.1) — no node_modules copy, no dev
 * dependencies shipped. Build args carry no secrets; every credential is
 * read at RUNTIME from the environment, so a rebuilt image is safe to
 * publish even though this repo is public.
 */

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',

  reactStrictMode: true,

  // Production error pages must never leak stack traces, key material, or
  // Stripe objects to the client (IMPLEMENTATION.md §3).
  productionBrowserSourceMaps: false,

  // Headers are also set in Caddy for the portal vhost; these are the
  // defence-in-depth copy for direct-to-container access.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy',    value: 'no-referrer' },
          { key: 'X-Frame-Options',    value: 'DENY' },
        ],
      },
      {
        // The sign-in page must never be framed (clickjacking on a
        // credential form) and must not be cached by intermediaries.
        source: '/sign-in',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cache-Control',    value: 'no-store' },
        ],
      },
    ];
  },

  // The dashboard sends no third-party requests and loads no remote
  // fonts/images; a tight CSP here also blocks the exfiltration path if
  // rendered model output ever reaches a page.
  async rewrites() {
    return [];
  },
};

export default nextConfig;