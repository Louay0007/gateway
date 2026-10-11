/**
 * Module resolve hook: extensionless TypeScript imports, the way a
 * bundler resolves them.
 *
 * Two shapes are handled, and both exist because the portal is run by two
 * different resolvers:
 *
 *   `@/db`      the tsconfig path alias. Next.js resolves it; Node does
 *               not, and the job runner imports the SAME modules that
 *               serve requests.
 *   './schema'  a relative import with no extension — legal for a bundler,
 *               ERR_MODULE_NOT_FOUND for Node's ESM loader.
 *
 * The alternative is to rewrite those imports (extension-ful, alias-ful)
 * in ~20 library files, which forks the codebase's conventions in two
 * and invalidates every blame line that touches them. Twenty lines of
 * resolver keeps one convention everywhere. Registered by
 * scripts/register-ts-resolve.mjs via `node --import`.
 *
 * Scope note: this resolves BARE package imports (`drizzle-orm`) through
 * to Node normally. The hook only rewrites specifiers whose target is a
 * local TypeScript file.
 */

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** portal/ — the directory holding tsconfig.json. */
const ROOT = new URL('../', import.meta.url);

/** Directory indexes last: `@/db` is db/index.ts, not a stray db.ts. */
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function isFile(url) {
  const path = fileURLToPath(url);
  return existsSync(path) && statSync(path).isFile();
}

function firstFile(base, relative) {
  for (const suffix of CANDIDATES) {
    const candidate = new URL(relative + suffix, base);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const resolved = firstFile(ROOT, specifier.slice(2));
    if (resolved) return next(resolved.href, context);
  } else if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL
  ) {
    const resolved = firstFile(context.parentURL, specifier);
    if (resolved) return next(resolved.href, context);
  }
  return next(specifier, context);
}
