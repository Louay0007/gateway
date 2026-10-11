/**
 * GET /api/health — liveness for the container healthcheck and
 * `make health`.
 *
 * UNAUTHENTICATED BY DESIGN: a container healthcheck has no session, and
 * the answer must be a boolean. That constraint sets the ceiling on what
 * this endpoint may say, so it reports whether the two dependencies the
 * portal cannot work without are reachable — the portal database and the
 * gateway — and nothing else. No versions, no counts, no hostnames, no
 * configuration values. The individual components expose their real
 * diagnostics on the IP-gated admin host, where an unauthenticated caller
 * cannot reach them.
 *
 * LiteLLM budgets are enforced by Postgres (README "two things that will
 * bite you"), which is why a database probe is a gateway-health signal
 * and not just a portal one.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { LITELLM_BASE } from '@/lib/litellm/endpoint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function probe(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    // The reason is deliberately dropped: the response is public, and
    // "database unreachable" vs "DNS failure" is exactly the kind of
    // detail that helps someone map the deployment.
    void name;
    return false;
  }
}

export async function GET(): Promise<Response> {
  const [database, gateway] = await Promise.all([
    probe('database', () => db.execute(sql`SELECT 1`)),
    probe('gateway', () =>
      // /health/readiness, NOT /health. In current LiteLLM, the plain
      // /health route is authenticated and its post-auth check stalls
      // against a slow/flaky upstream (it timed out under load here),
      // which would couple portal liveness to upstream health and report
      // a healthy gateway as down. /health/readiness is the cheap,
      // unauthenticated "proxy is initialised and can serve" signal —
      // exactly what a healthcheck needs. Upstream reachability is the
      // gateway's own concern, surfaced on the admin host, not the
      // portal's liveness.
      fetch(`${LITELLM_BASE}/health/readiness`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      }).then((r) => {
        if (!r.ok) throw new Error(`gateway ${r.status}`);
      }),
    ),
  ]);

  const healthy = database && gateway;

  return Response.json(
    { status: healthy ? 'ok' : 'degraded', checks: { database, gateway } },
    {
      status: healthy ? 200 : 503,
      // Never cached: a cached "ok" is a health check that lies.
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
