/**
 * The canonical public origin, for routes that cannot ask the request.
 *
 * WHY THIS IS NOT JUST `process.env.NEXT_PUBLIC_APP_URL`. Next replaces every
 * `NEXT_PUBLIC_*` reference with a build-time literal, and `/sitemap.xml` and
 * `/robots.txt` are prerendered — so their value comes from the BUILD, not
 * from the container's runtime environment. Production had the right runtime
 * value and still shipped `http://localhost:3000` to crawlers, because the
 * build arg was never passed (see portal/Dockerfile and docker-compose.yml).
 *
 * `APP_URL` is read at runtime and is the value an operator can change without
 * a rebuild. The NEXT_PUBLIC fallback and the localhost default exist for
 * `next dev` and for a plain `next start` outside Docker.
 */
export const SITE_URL = (
  process.env.APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");
