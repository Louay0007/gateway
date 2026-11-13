import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-url";

/**
 * Robots directives — tells crawlers what to index.
 *
 * Allow everything except auth-gated and admin routes. The sitemap
 * already excludes them, but an explicit Disallow prevents crawlers
 * from discovering them through link-following or parameter probing.
 *
 * The sitemap origin is the same `SITE_URL` the sitemap itself uses, so the
 * two can never point a crawler at different hosts.
 */
export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL;

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // `/share/` is a private grant, not a publication. The page also
        // sends `noindex`, but that relies on the crawler obeying it AFTER
        // fetching and rendering the transcript. A Disallow means it never
        // gets that far.
        disallow: [
          "/admin/",
          "/dashboard/",
          "/checkout/",
          "/device/",
          "/api/",
          "/billing/",
          "/share/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}