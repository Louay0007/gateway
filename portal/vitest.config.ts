import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    // The pricing loader reads a file and sync.ts imports the DB client;
    // neither should be exercised without an explicit env. Unit tests
    // cover pure logic only.
    //
    // A module that imports `@/db` throws at import time when this is
    // absent, which fails the SUITE before a single pure function runs.
    // postgres-js connects lazily, so a placeholder here opens nothing —
    // it only lets a file like lib/chat/share.ts be imported for the
    // helpers it also exports.
    env: {
      DATABASE_URL: 'postgres://unit-test@127.0.0.1:5432/unit-test',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});