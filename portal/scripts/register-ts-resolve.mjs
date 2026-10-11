/**
 * Registers the TypeScript resolve hook before the entry module loads.
 * See scripts/ts-resolve.mjs for why the job runner needs it.
 *
 *   node --import ./scripts/register-ts-resolve.mjs \
 *        --experimental-strip-types scripts/jobs.ts
 */

import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);
