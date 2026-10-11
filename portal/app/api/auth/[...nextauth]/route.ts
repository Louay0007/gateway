/**
 * Auth route handlers.
 *
 * Auth.js v5 mounts its entire endpoint at /api/auth/* — sign-in, CSRF,
 * session. The framework handles CSRF protection and cookie hardening;
 * nothing here overrides it.
 */

import { handlers } from '@/auth';

export const { GET, POST } = handlers;

// The handler must run in Node: it verifies scrypt hashes and talks to
// Postgres. The Edge runtime would fail at the adapter import.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';