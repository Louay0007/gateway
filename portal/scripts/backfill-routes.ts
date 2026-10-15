/**
 * One-off backfill: re-derive `route` for ledger rows stored as `unknown`.
 *
 * WHY A SCRIPT AND NOT A MIGRATION. `usage_records` lives in the portal
 * database; the call types that identify each row's route live in LiteLLM's
 * spend table, a different database on the same host. A SQL migration cannot
 * join across the two, so this runs from the jobs image, which can reach both
 * the gateway API and the portal DB.
 *
 * MATCHING. Each unknown row is matched to a spend row on all three of:
 *   1. the org (spend `team_id` → `organizations.litellm_team_id`),
 *   2. the exact timestamp (`occurred_at` was written from `startTime`),
 *   3. the token counts (input+output), which disambiguates two requests in
 *      the same second.
 * A row with zero candidate spend rows, or with more than one, is left as
 * `unknown` and reported — guessing a route is worse than showing none.
 *
 * IDEMPOTENT. Only touches rows whose route is still `unknown`, and only
 * writes one of chat/messages/responses/models/key-info. Re-running changes
 * nothing.
 *
 * Usage (from the repo root, against the VPS):
 *   docker compose run --rm --no-deps jobs node --experimental-transform-types \
 *     --import ./scripts/register-ts-resolve.mjs scripts/backfill-routes.ts [--apply]
 * Without --apply it reports what it WOULD change and exits 0.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { usageRecords } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getSpendLogs, type SpendLogRow } from '@/lib/litellm/client';
import { routeForCallType } from '@/lib/pricing/alias';

const APPLY = process.argv.includes('--apply');

interface Candidate {
  id: number;
  model: string;
  occurredAt: Date;
  inputTokens: number;
  outputTokens: number;
  orgId: string;
}

/** Millis since epoch, or NaN. Compares across timestamptz/timestamp/text. */
function epochMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    // LiteLLM serializes some timestamps without a zone designator; treat a
    // bare `YYYY-MM-DD HH:MM:SS.fff` as UTC rather than local time, or every
    // comparison shifts by the container's offset.
    const s = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v.trim()) ? `${v.trim()}Z` : v;
    return new Date(s).getTime();
  }
  return NaN;
}

async function backfillMain(): Promise<void> {
  // NOTE: raw SQL returns snake_case keys (`occurred_at`, `input_tokens`,
  // `organization_id`), NOT the camelCase the drizzle schema uses. Reading
  // `r.occurredAt` here yields undefined for every row — which is exactly
  // what happened in the first version of this script: all 237 timestamps
  // parsed as NaN and the backfill "matched" nothing.
  const unknownRows = (await db.execute(sql`
    SELECT u.id, u.model, u.occurred_at, u.input_tokens, u.output_tokens,
           u.organization_id, o.litellm_team_id AS team_id
      FROM usage_records u
      JOIN organizations o ON o.id = u.organization_id
     WHERE u.route = 'unknown'
     ORDER BY u.occurred_at ASC
  `)) as unknown as (Omit<Candidate, 'occurredAt' | 'inputTokens' | 'outputTokens' | 'orgId'> & {
    occurred_at: unknown;
    input_tokens: number;
    output_tokens: number;
    organization_id: string;
    team_id: string | null;
  })[];

  if (unknownRows.length === 0) {
    console.log('  no unknown routes left — nothing to do');
    return;
  }

  // Pull the spend history in day-sized windows covering the unknown rows.
  // `occurred_at` arrives from postgres-js as a Date; guard the conversion
  // because one malformed timestamp must not abort the whole backfill.
  const days = new Set<string>();
  for (const r of unknownRows) {
    const t = epochMs(r.occurred_at);
    if (Number.isFinite(t)) days.add(new Date(t).toISOString().slice(0, 10));
  }
  const spendByTeamTime = new Map<string, SpendLogRow[]>();
  let fetchedSpend = 0;
  for (const day of [...days].sort()) {
    const end = new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10);
    const rows = await getSpendLogs({ startDate: day, endDate: end, page: 1, pageSize: 1000 });
    fetchedSpend += rows.length;
    for (const r of rows) {
      if (!r.team_id || r.startTime == null) continue;
      const t = epochMs(r.startTime);
      if (!Number.isFinite(t)) continue;
      const key = `${r.team_id}|${t}`;
      const list = spendByTeamTime.get(key) ?? [];
      list.push(r);
      spendByTeamTime.set(key, list);
    }
  }

  let matched = 0;
  let ambiguous = 0;
  let missing = 0;
  const byRoute = new Map<string, number>();

  for (const u of unknownRows) {
    if (!u.team_id) { missing++; continue; }
    const t = epochMs(u.occurred_at);
    if (!Number.isFinite(t)) { missing++; continue; }
    const key = `${u.team_id}|${t}`;
    const cands = (spendByTeamTime.get(key) ?? []).filter((s) => {
      const prompt = Number((s as unknown as Record<string, unknown>).prompt_tokens ?? 0);
      const completion = Number((s as unknown as Record<string, unknown>).completion_tokens ?? 0);
      return prompt + completion === u.input_tokens + u.output_tokens;
    });

    if (cands.length === 0) { missing++; continue; }
    if (cands.length > 1) { ambiguous++; continue; }

    const route = routeForCallType(cands[0]!.call_type, cands[0]!.endpoint);
    if (route === 'unknown') { missing++; continue; }

    matched++;
    byRoute.set(route, (byRoute.get(route) ?? 0) + 1);
    if (APPLY) {
      await db.update(usageRecords).set({ route }).where(eq(usageRecords.id, u.id));
    }
  }

  console.log(`  unknown rows : ${unknownRows.length}`);
  console.log(`  spend rows   : ${fetchedSpend} (across ${days.size} day windows)`);
  console.log(`  matched      : ${matched} ${APPLY ? '(written)' : '(dry run — pass --apply to write)'}`);
  for (const [route, n] of [...byRoute.entries()].sort()) console.log(`    ${route}: ${n}`);
  console.log(`  ambiguous    : ${ambiguous} (left as unknown)`);
  console.log(`  no spend row : ${missing} (left as unknown)`);
}

// NOTE on matching: rows are matched by (team, timestamp, token counts), and
// the dedupe hash is deliberately NOT recomputed here. Recomputing it would
// need byte-identical startTime strings from the spend API — a format
// dependency on LiteLLM's serializer, where one upgrade changes the shape
// and the backfill silently matches nothing.

backfillMain().then(
  () => process.exit(0),
  (e) => { console.error('  backfill-routes failed:', e); process.exit(1); },
);
