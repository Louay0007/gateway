/**
 * Next.js configuration.
 *
 * `output: 'standalone'` produces a minimal server bundle for the
 * Dockerfile — no node_modules copy, no dev
 * dependencies shipped. Build args carry no secrets; every credential is
 * read at RUNTIME from the environment, so a rebuilt image is safe to
 * publish even though this repo is public.
 */

import type { NextConfig } from 'next';

/**
 * Content-Security-Policy.
 *
 * WHY IT EXISTS NOW. The chat product renders model output. The renderer
 * is `streamdown` (components/chat/chat-view.tsx), whose pipeline is
 * raw → rehype-sanitize → rehype-harden: raw HTML in a model reply is
 * sanitised, never trusted, and links open through a safety modal. That is
 * a library's promise, not ours — the day it is swapped, downgraded, or
 * configured with `allowedTags`, the promise changes without this file
 * changing. The CSP is the boundary that does not depend on it.
 *
 * WHAT EACH ALLOWANCE IS FOR, so the next person can tell intent from
 * accident:
 *
 *   script-src 'self' 'unsafe-inline'
 *     Next's App Router ships inline bootstrap scripts (`self.__next_f`)
 *     and, without a nonce wired through middleware, `unsafe-inline` is the
 *     only way to let them run. It is a real weakening and it is recorded
 *     here rather than discovered later. `object-src 'none'` and the absence
 *     of any remote script origin are what hold the line meanwhile; the
 *     upgrade path is a nonce via middleware.ts.
 *   style-src 'self' 'unsafe-inline'
 *     Tailwind ships a stylesheet, but React inlines `style={{...}}` for
 *     animation delays and the sidebar's CSS variables.
 *   img-src 'self' data: https://cdn.21st.dev
 *     The restored marketing page hot-links seven vendor illustrations.
 *     Everything in the product itself is local (`/images/**`). Model
 *     output cannot load a remote image: markdown images resolve here, and
 *     a third-party host is not in the list — deliberate, because a model
 *     reply is attacker-influenced text and a remote image is an
 *     exfiltration channel.
 *   connect-src 'self'
 *     The only outbound calls a browser makes here are same-origin `fetch`
 *     to /api/*. The portal never calls the gateway or Stripe directly —
 *     that is the whole point of POST /api/chat.
 *   frame-ancestors 'none'
 *     Matches X-Frame-Options: DENY, which predates CSP and is kept for
 *     older browsers.
 *   form-action 'self'
 *     Sign-in, sign-up and the password forms all post same-origin.
 *
 * `frame-src 'none'` and `object-src 'none'` are belt-and-braces: nothing
 * on this product embeds anything.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.21st.dev",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',

  /**
   * Redirects that must happen BEFORE React renders.
   *
   * WHY HERE AND NOT `redirect()` IN A PAGE. A page-level `redirect()` in a
   * streamed server component emits a client-side meta-tag redirect, so the
   * HTTP response is a 200 and only a browser follows it — a curl, a crawler
   * or a fetch sees success and stops. Next's own redirecting guide says to
   * use this table for "redirect an incoming request based on a path", which
   * is exactly what a retired URL is.
   *
   * The trailing-slash-free path keeps the query string automatically
   * (`?tab=keys` survives), which matters: the chat sidebar linked
   * `/settings?tab=keys` for months and a bookmark must land on the right
   * tab rather than the default one.
   */
  async redirects() {
    return [
      {
        source: '/settings',
        destination: '/dashboard/settings',
        // 308: the old URL is not coming back, and preserving the method
        // means a POST to a retired path fails loudly instead of silently
        // becoming a GET.
        permanent: true,
      },
    ];
  },

  reactStrictMode: true,

  // Next 16 blocks cross-origin dev requests by default, and the portal
  // is reached as both `localhost` (AUTH_URL) and `127.0.0.1` (local
  // curls, headless checks). Without this the dev server refuses
  // /_next/* requests from the other host, which breaks hot reload —
  // and, worse, leaves a half-loaded bundle that fails to hydrate.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  // Production error pages must never leak stack traces, key material, or
  // Stripe objects to the client.
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
          { key: 'Content-Security-Policy', value: CSP },
        ],
      },
      {
        /*
         * A share link must stop working the moment it is revoked. Caddy
         * sits in front of this app, and `force-dynamic` only stops NEXT
         * from caching the render — a proxy or a browser back/forward cache
         * would still replay a revoked transcript. `no-store` is the one
         * header that forbids every cache in the chain.
         *
         * `X-Robots-Tag` duplicates the page's own `robots` metadata for
         * anything that reads headers instead of parsing HTML.
         */
        source: '/share/:token*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
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