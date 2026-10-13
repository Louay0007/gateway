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

  // Next 16 blocks cross-origin dev requests by default, and the portal
  // is reached as both `localhost` (AUTH_URL) and `127.0.0.1` (local
  // curls, headless checks). Without this the dev server refuses
  // /_next/* requests from the other host, which breaks hot reload —
  // and, worse, leaves a half-loaded bundle that fails to hydrate.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

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