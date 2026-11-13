/**
 * GET /changelog.xml — the changelog as an RSS 2.0 feed.
 *
 * WHY A ROUTE, NOT A STATIC FILE. The entries live in
 * `lib/changelog/entries.ts` and are also rendered by
 * `components/marketing/changelog-content.tsx`. A hand-maintained XML file
 * is the classic way a page and its feed drift until someone notices the
 * feed stopped in March.
 *
 * `force-dynamic` so the origin comes from `SITE_URL` at runtime (the same
 * helper /sitemap.xml uses) rather than being baked in at build time — the
 * bug that once shipped `http://localhost:3000` to crawlers.
 *
 * RSS 2.0 rather than Atom: every reader and every podcast-ish consumer
 * handles it, and the description field carries the whole entry body so a
 * subscriber gets the content without clicking through.
 */

import { CHANGELOG } from '@/lib/changelog/entries';
import { SITE_URL } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

const FEED_TITLE = 'Zaino AI — changelog';
const FEED_DESCRIPTION =
  'Every release: what changed, what broke, and the numbers behind the fix.';

/** Total, not partial: most changelog dates are "Oct 26, 2026" strings. */
const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * "Oct 26, 2026" → "2026-10-26T00:00:00Z".
 *
 * The entries are authored by hand, so this must never throw: an
 * unparseable date falls back to the epoch, which sorts to the bottom
 * instead of breaking the feed.
 */
function rfc822(date: string): string {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(date.trim());
  const iso = m ? `${m[3]}-${MONTHS[m[1]!]}-${m[2]!.padStart(2, '0')}T00:00:00Z` : null;
  const d = iso ? new Date(iso) : new Date(0);
  return d.toUTCString();
}

/** XML text escape. Entries contain quotes, apostrophes and `&`. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(): Promise<Response> {
  const items = CHANGELOG.map((e) => {
    // The feed carries the full entry, so a reader does not need the page.
    const body = [
      e.description,
      ...e.details.map((d) => `${d.heading}\n${d.body}`),
    ].join('\n\n');

    const link = `${SITE_URL}/changelog#${e.version}`;

    return `    <item>
      <title>${esc(`${e.version} — ${e.title}`)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="false">${esc(`zaino:${e.version}`)}</guid>
      <pubDate>${rfc822(e.date)}</pubDate>
      <description>${esc(body)}</description>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(FEED_TITLE)}</title>
    <link>${esc(`${SITE_URL}/changelog`)}</link>
    <description>${esc(FEED_DESCRIPTION)}</description>
    <language>en</language>
    <atom:link href="${esc(`${SITE_URL}/changelog.xml`)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // Crawlable, and cheap enough that caching for an hour is safe.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
