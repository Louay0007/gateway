import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * `import 'dotenv/config'` only reads `.env`, and there is no `.env` in this
 * directory — the DSN lives in `.env.local`, which is the file Next.js
 * prefers and the file `scripts/env.mjs` already loads. So `npm run
 * db:migrate` failed with `Please provide required params for Postgres
 * driver: [x] url: ''` on a machine whose database was up and reachable.
 *
 * Same two files, same order, same "dotenv never overwrites an existing
 * variable" rule as `scripts/env.mjs`: this is the ONE place the portal
 * loads env from disk, and drizzle-kit has to agree with it.
 *
 * 0001_init.sql is hand-written and is NOT managed by drizzle-kit — it
 * already exists and must never be regenerated. New changes go to
 * 0002_*.sql (MASTER_PROMPT §3).
 */
for (const file of ['.env.local', '.env']) {
  loadEnv({ path: file, quiet: true });
}
export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});