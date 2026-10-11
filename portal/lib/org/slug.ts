/**
 * Organization slug — pure string logic, no database.
 *
 * Extracted from provision.ts so it can be unit-tested without Postgres.
 * The DB is an implementation detail of provisioning; the rules for
 * turning a display name into a URL-safe identifier are not.
 */

/**
 * Normalise a display name into a URL-safe slug.
 *
 * Accented characters are stripped rather than transliterated (é → e,
 * not é → e) to avoid a transliteration table this module would then have
 * to maintain and test. Names that reduce to nothing fall back to 'org'
 * so the caller always has something usable.
 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks left behind by NFKD.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'org';
}

/**
 * Candidate list for a unique slug.
 *
 * Rather than querying for a collision and retrying, produce a few
 * candidates with a random suffix and let the caller take the first that
 * is free. The suffix keeps two people named "Alex Kim" from colliding on
 * first login without a serializable round trip.
 */
export function slugCandidates(input: string, attempts = 5): string[] {
  const base = slugify(input);
  return Array.from({ length: attempts }, (_, i) =>
    i === 0 ? base : `${base}-${randomSuffix()}`,
  );
}

function randomSuffix(): string {
  return crypto.randomUUID().slice(0, 6);
}