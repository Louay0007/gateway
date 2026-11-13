import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-url";

/**
 * Sitemap — tells search engines which public pages exist.
 *
 * Only marketing and auth-entry pages are listed. Dashboard, admin,
 * checkout, and device-verification routes are gated behind auth or
 * contain user-specific data; indexing them would surface 401/403
 * responses in search results and leak route structure.
 *
 * The base URL comes from `SITE_URL`, which prefers the runtime APP_URL and
 * otherwise a build-time NEXT_PUBLIC_APP_URL (see lib/site-url.ts for why a
 * runtime-only value is not enough here).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL;

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/pricing`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    // /connect is the conversion page: a developer who lands here goes from
    // nothing to a 200. It outranks /docs, which is reference rather than
    // onboarding.
    {
      url: `${base}/connect`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${base}/faq`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${base}/contact`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.6,
    },
    {
      url: `${base}/download`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/changelog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${base}/docs`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${base}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/sign-in`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${base}/sign-up`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  return staticPages;
}