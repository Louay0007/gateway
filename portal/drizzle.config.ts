import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * 0001_init.sql is hand-written and is NOT managed by drizzle-kit — it
 * already exists and must never be regenerated. New changes go to
 * 0002_*.sql (MASTER_PROMPT §3).
 */
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