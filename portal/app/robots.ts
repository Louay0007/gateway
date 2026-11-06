import type { MetadataRoute } from "next";

/**
 * Robots directives — tells crawlers what to index.
 *
 * Allow everything except auth-gated and admin routes. The sitemap
 * already excludes them, but an explicit Disallow prevents crawlers
 * from discovering them through link-following or parameter probing.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

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