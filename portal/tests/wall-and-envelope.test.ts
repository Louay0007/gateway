import { describe, it, expect } from 'vitest';
import { jsonError, type ApiErrorCode } from '@/lib/api/errors';
import { wallReason } from '@/lib/chat/wall';
import { staffAtLeast, STAFF_ROLES } from '@/lib/auth/staff-roles';
import type { AllowedModelsResult } from '@/lib/entitlements/allowed-models';

function wall(partial: Partial<AllowedModelsResult>): AllowedModelsResult {
  return {
    effect: 'full',
    entitled: ['fast', 'smart'],
    allowed: ['fast', 'smart'],
    tokenLimits: {},
    usedTokensBy: {},
    period: null,
    planCode: 'pro',
    ...partial,
  };
}

describe('plan wall', () => {
  it('lets an entitled, unexhausted alias through', () => {
    expect(wallReason(wall({}), 'smart')).toBeNull();
  });

  it('402 when the org has no plan at all', () => {
    const r = wallReason(wall({ entitled: [], allowed: [] }));
    expect(r?.code).toBe('payment_required');
  });

  it('403 (not 402) when a paying org has spent its budget', () => {
    const r = wallReason(wall({ allowed: [] }));
    expect(r?.code).toBe('forbidden');
    expect(r?.message).toMatch(/token budget/i);
  });

  it('403 when the alias is not on the plan', () => {
    expect(wallReason(wall({}), 'fable')?.code).toBe('forbidden');
  });

  it('no alias means "any allowed" — a schedule with no explicit model', () => {
    expect(wallReason(wall({ allowed: ['fast'] }), undefined)).toBeNull();
  });
});

describe('error envelope', () => {
  const cases: [ApiErrorCode, number][] = [
    ['unauthorized', 401],
    ['forbidden', 403],
    ['not_found', 404],
    ['conflict', 409],
    ['validation', 400],
    ['payment_required', 402],
    ['gone', 410],
    ['rate_limited', 429],
    ['upstream', 502],
    ['internal', 500],
  ];

  for (const [code, status] of cases) {
    it(`${code} → ${status} with { error: { code, message } }`, async () => {
      const res = jsonError(code, 'detail');
      expect(res.status).toBe(status);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe(code);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
    });
  }

  it('replaces internal/upstream detail instead of forwarding it', async () => {
    for (const code of ['internal', 'upstream'] as const) {
      const body = (await jsonError(code, 'LiteLLM /key/generate -> 500 body').json()) as {
        error: { message: string };
      };
      expect(body.error.message).not.toContain('LiteLLM');
    }
  });

  it('carries Retry-After when given headers', () => {
    const res = jsonError('rate_limited', 'slow down', { 'Retry-After': '42' });
    expect(res.headers.get('retry-after')).toBe('42');
  });
});

describe('staff rank ladder (drives requireOperator)', () => {
  it('is total and ordered', () => {
    expect(STAFF_ROLES).toEqual(['read_only', 'support', 'admin', 'owner']);
    expect(staffAtLeast('read_only', 'support')).toBe(false);
    expect(staffAtLeast('support', 'support')).toBe(true);
    expect(staffAtLeast('admin', 'support')).toBe(true);
    expect(staffAtLeast('support', 'admin')).toBe(false);
    expect(staffAtLeast('owner', 'owner')).toBe(true);
  });
});
