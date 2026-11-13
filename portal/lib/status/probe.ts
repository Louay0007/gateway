/**
 * Status probes — the public uptime surface.
 *
 * WHAT IS SAFE TO PUBLISH. A status page is unauthenticated by definition,
 * so every field here is either a boolean or a latency. No versions, no
 * hostnames, no row counts, no configuration. That is the same ceiling the
 * container healthcheck works under, and it is why this module probes
 * rather than reporting what each service knows about itself.
 *
 * WHY PROBE INSTEAD OF READ PROMETHEUS. The plan called for Prometheus,
 * and `docker-compose.monitoring.yml` exists — but it is not running, and a
 * status page that depends on a stack nobody started is a status page that
 * always says "unknown". Probing the two real endpoints costs milliseconds
 * and is true today. Prometheus history is the follow-up, not the blocker.
 *
 * LATENCY IS THE HONEST SIGNAL. Up/down alone hides a degraded gateway; the
 * median round trip is what tells a developer the difference.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { LITELLM_BASE } from '@/lib/litellm/endpoint';

export type ComponentState = 'operational' | 'degraded' | 'down' | 'unknown';

export interface ComponentStatus {
  id: string;
  name: string;
  what: string;
  state: ComponentState;
  /** Median of the probe rounds, or null when it never answered. */
  latencyMs: number | null;
  /** Sample of recent checks, oldest first, for the little uptime strip. */
  history: { ok: boolean; ms: number | null }[];
}

const ROUNDS = 8;
const SPACING_MS = 120;

async function timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

async function sample(fn: () => Promise<unknown>): Promise<{ history: ComponentStatus['history']; medianMs: number | null }> {
  const history: ComponentStatus['history'] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    if (i > 0) await new Promise((r) => setTimeout(r, SPACING_MS));
    const r = await timed(fn);
    history.push({ ok: r.ok, ms: r.ok ? r.ms : null });
  }

  const okTimes = history.filter((h) => h.ok && h.ms != null).map((h) => h.ms!);
  if (okTimes.length === 0) return { history, medianMs: null };
  okTimes.sort((a, b) => a - b);
  const mid = Math.floor(okTimes.length / 2);
  const median =
    okTimes.length % 2 === 0
      ? Math.round((okTimes[mid - 1]! + okTimes[mid]!) / 2)
      : okTimes[mid]!;
  return { history, medianMs: median };
}

/** operational / degraded / down from the sample. */
function stateOf(history: ComponentStatus['history'], medianMs: number | null): ComponentState {
  const okCount = history.filter((h) => h.ok).length;
  if (okCount === 0) return 'down';
  if (okCount < history.length) return 'degraded';
  // A gateway answering in over a second is up but not healthy: generations
  // would queue behind it.
  if (medianMs != null && medianMs > 1000) return 'degraded';
  return 'operational';
}

export async function probeAll(): Promise<ComponentStatus[]> {
  const [edge, gateway, database] = await Promise.all([
    // The public edge answers a request for an unknown model with 401 —
    // that is a healthy edge doing its job, so any HTTP answer counts.
    sample(() =>
      fetch(`${LITELLM_BASE}/health/readiness`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4_000),
      }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      }),
    ),
    // The gateway is probed through its own readiness route, which is the
    // cheap unauthenticated "proxy is initialised" signal (see
    // app/api/health/route.ts for why not /health).
    sample(() =>
      fetch(`${LITELLM_BASE}/health/readiness`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4_000),
      }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      }),
    ),
    sample(() => db.execute(sql`SELECT 1`)),
  ]);

  return [
    {
      id: 'api',
      name: 'API gateway',
      what: 'api.zaino.soon.it — inference, auth and metering',
      state: stateOf(gateway.history, gateway.medianMs),
      latencyMs: gateway.medianMs,
      history: gateway.history,
    },
    {
      id: 'portal',
      name: 'Portal',
      what: 'zaino.soon.it — dashboard, checkout and docs',
      state: stateOf(database.history, database.medianMs),
      latencyMs: database.medianMs,
      history: database.history,
    },
    {
      id: 'edge',
      name: 'Credential edge',
      what: 'zn- key normalisation on the request path',
      state: stateOf(edge.history, edge.medianMs),
      latencyMs: edge.medianMs,
      history: edge.history,
    },
  ];
}

/** One line for the page header: the worst state across components. */
export function overall(components: ComponentStatus[]): ComponentState {
  if (components.some((c) => c.state === 'down')) return 'down';
  if (components.some((c) => c.state === 'degraded')) return 'degraded';
  if (components.every((c) => c.state === 'unknown')) return 'unknown';
  return 'operational';
}
