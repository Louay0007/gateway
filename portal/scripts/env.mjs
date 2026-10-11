/**
 * Environment bootstrap for the job runner.
 *
 * MUST be the first import in scripts/jobs.ts. `@/db` reads
 * DATABASE_URL at module-evaluation time and throws when it is missing,
 * and ESM evaluates every import before the importing module's body runs
 * — so a `loadEnv()` call inside jobs.ts would happen far too late.
 *
 * In Docker the environment arrives from docker-compose; on the VPS and
 * in local development these files are the same ones Next.js reads. dotenv
 * never overwrites a variable that is already set, so compose always wins.
 */

import { config as loadEnvFile } from 'dotenv';

for (const file of ['.env.local', '.env']) {
  loadEnvFile({ path: new URL(`../${file}`, import.meta.url), quiet: true });
}
