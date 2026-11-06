/**
 * listTeamKeys must return EVERY key on a team.
 *
 * The bug this pins down was silent and customer-facing: `/key/list` clamps
 * `size` at 10 server-side whatever you ask for, and the first version of
 * this loop exited when a page came back short. A page always came back
 * short (10 < 100), so sync pushed the plan to the first ten keys and
 * stopped. The two newest keys kept the previous allowlist forever, the
 * dashboard showed the new lineup, and the reconcile reported `synced`.
 *
 * Observed live: a pro org whose twelfth key answered 400 "model not
 * allowed" on the fourth alias while the other eleven served it.
 *
 * The fake below reproduces the clamp exactly — both the 10-row cap and the
 * `page`/`total_pages` fields — so a "simplification" back to
 * `batch.length < pageSize` fails here instead of in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SERVER_CLAMP = 10;

function fakeGateway(total: number) {
  const all = Array.from({ length: total }, (_, i) => `tok${i}`);
  return vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
    if (page < 1) {
      return new Response(
        JSON.stringify({ detail: 'Input should be greater than or equal to 1' }),
        { status: 422 },
      );
    }
    return new Response(
      JSON.stringify({
        keys: all.slice((page - 1) * SERVER_CLAMP, page * SERVER_CLAMP),
        total_count: total,
        current_page: page,
        total_pages: Math.max(1, Math.ceil(total / SERVER_CLAMP)),
      }),
      { status: 200 },
    );
  });
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.LITELLM_INTERNAL_URL = 'http://litellm.test';
  process.env.LITELLM_MASTER_KEY = 'sk-test';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL };
});

describe('listTeamKeys', () => {
  it('returns every key when the team has more than one server page', async () => {
    const fetchSpy = fakeGateway(12);
    vi.stubGlobal('fetch', fetchSpy);
    const { listTeamKeys } = await import('@/lib/litellm/client');

    const keys = await listTeamKeys('team-a');

    expect(keys).toHaveLength(12);
    expect(keys.map((k) => k.token)).toEqual(
      Array.from({ length: 12 }, (_, i) => `tok${i}`),
    );
    // Two pages of ten, not one.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('stops at one page when the team fits in one', async () => {
    const fetchSpy = fakeGateway(3);
    vi.stubGlobal('fetch', fetchSpy);
    const { listTeamKeys } = await import('@/lib/litellm/client');

    expect(await listTeamKeys('team-b')).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('never sends page=0, which the gateway rejects with 422', async () => {
    const fetchSpy = fakeGateway(12);
    vi.stubGlobal('fetch', fetchSpy);
    const { listTeamKeys } = await import('@/lib/litellm/client');

    await listTeamKeys('team-c');

    for (const [url] of fetchSpy.mock.calls) {
      expect(String(url)).not.toMatch(/[?&]page=0(&|$)/);
    }
  });
});
