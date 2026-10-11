/**
 * Portal database client.
 *
 * Two databases, one cluster (PLATFORM.md §1.2):
 *   - `litellm` — owned by LiteLLM. This portal NEVER queries it. All
 *     gateway access goes through REST (portal/lib/litellm/client.ts).
 *   - `portal`  — owned by us. This file connects to that one only.
 *
 * If DATABASE_URL points at the litellm database, that is a deployment
 * mistake we refuse to serve, not a warning.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

if (/\/litellm(\?|$)/.test(DATABASE_URL)) {
  throw new Error(
    'DATABASE_URL points at the litellm database. The portal must use its own ' +
    'database; LiteLLM owns that schema and runs its own migrations. See ' +
    'PLATFORM.md §1.2.',
  );
}

export const sql = postgres(DATABASE_URL, {
  // The job runner and the request path share one pool. Sized for a
  // 2-vCPU box: enough for the collector, the rollup, and a handful of
  // concurrent dashboard queries without starving LiteLLM's own pool.
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Fail fast rather than queueing indefinitely behind a stuck connection.
  // A hung portal request is worse than a visible 500.
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

export { schema };