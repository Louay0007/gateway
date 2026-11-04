/**
 * Where the price table lives — resolved once, for every reader.
 *
 * `PRICE_FILE` was read by two files (`lib/pricing/index.ts` and
 * `lib/pricing/alias.ts`) with two different defaults, neither of which
 * was right on the host: they resolved against `process.cwd()`, so running
 * the job runner from `portal/` looked for `portal/prices/models.yaml`,
 * which does not exist — the table is at the repository root and is only
 * bind-mounted to `/app/prices` inside the containers. The symptom was a
 * collect_usage job that failed with ENOENT on a correctly configured
 * machine.
 *
 * So: honour `PRICE_FILE` when set (compose always sets it), otherwise try
 * the two real locations. `existsSync` runs once at import, and only when
 * the variable is absent.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

function resolve(): string {
  if (process.env.PRICE_FILE) return process.env.PRICE_FILE;

  // cwd/prices (the gateway root) then cwd/../prices (inside portal/).
  for (const candidate of [
    path.join(process.cwd(), 'prices/models.yaml'),
    path.join(process.cwd(), '..', 'prices/models.yaml'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  // Neither exists: return the first so the ENOENT names a real candidate
  // instead of a bare relative string.
  return path.join(process.cwd(), 'prices/models.yaml');
}

export const PRICE_FILE = resolve();
