import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    // The pricing loader reads a file and sync.ts imports the DB client;
    // neither should be exercised without an explicit env. Unit tests
    // cover pure logic only.
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});