/**
 * The console's Auth.js endpoints — a DIFFERENT mount from /api/auth/*.
 *
 * Separate so the console's CSRF/session/callback surface is never reachable
 * under the customer auth namespace, and so `route-policy.ts` buckets it
 * explicitly instead of inheriting `/api/auth/*`'s "public because sign-in is
 * public" reasoning wholesale.
 *
 * `@auth/core` builds its action URLs from AUTH_URL (the portal origin), but
 * `signIn()` runs Auth() in-process and sets the cookie on the CURRENT
 * response — so submitting the /admin/login form on the console host mints
 * the console cookie there, which is what makes a cross-host console login
 * work at all.
 */

import { adminHandlers } from '@/lib/auth/admin-auth';

export const { GET, POST } = adminHandlers;

// Node, not Edge: the handler verifies scrypt hashes and talks to Postgres.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
