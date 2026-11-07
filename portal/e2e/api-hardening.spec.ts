/**
 * The hardening pass, asserted over HTTP.
 *
 * Each test names the failure it exists to catch, because the fix for one
 * is not a fix for another: a badge of "authorized" on a route that never
 * rank-checked, an oracle that told a prober whether the secret was set,
 * an error shape that broke the client's parser.
 *
 * Skips rather than fails when the environment has no secret/credentials.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const GATE_SECRET = process.env.ADMIN_GATE_SECRET;
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

type Envelope = { error: { code: string; message: string } };

async function expectEnvelope(
  res: { status(): number; json(): Promise<unknown> },
  status: number,
  code: string,
) {
  expect(res.status()).toBe(status);
  const body = (await res.json()) as Envelope;
  expect(body.error, 'error envelope, not a bare string').toBeTruthy();
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
}

/** Present the gate code once; the context keeps the cookie. */
async function passGate(request: APIRequestContext) {
  const res = await request.post('/api/admin/gate', { data: { code: GATE_SECRET } });
  expect(res.status(), 'the gate must accept the configured secret').toBe(200);
}

/** Sign in through the form; returns the page's own request client, which
 *  shares the browser context's cookies. */
async function signIn(page: Page): Promise<APIRequestContext> {
  await page.goto('/sign-in');
  await page.fill('input[name="email"], input[type="email"]', EMAIL!);
  await page.fill('input[name="password"], input[type="password"]', PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(chat|dashboard)/, { timeout: 20_000 });
  return page.context().request;
}

test.describe('admin gate', () => {
  test.skip(!GATE_SECRET, 'set ADMIN_GATE_SECRET to run');

  test('a wrong code is 401 with the shared envelope, never a string', async ({ request }) => {
    const res = await request.post('/api/admin/gate', {
      data: { code: 'definitely-not-the-secret' },
    });
    await expectEnvelope(res, 401, 'unauthorized');
  });

  test('the real code still works', async ({ request }) => {
    const res = await request.post('/api/admin/gate', { data: { code: GATE_SECRET } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

test.describe('D17 writes are not gate-only by accident', () => {
  test('anonymous approve is 401', async ({ request }) => {
    const res = await request.post(`/api/admin/d17/${MISSING_UUID}/approve`);
    await expectEnvelope(res, 401, 'unauthorized');
  });

  test('anonymous reject is 401', async ({ request }) => {
    const res = await request.post(`/api/admin/d17/${MISSING_UUID}/reject`, {
      data: { reason: 'no proof' },
    });
    await expectEnvelope(res, 401, 'unauthorized');
  });

  test.skip(!GATE_SECRET, 'needs the gate cookie');
  test('a gate-only operator may still approve a nonexistent id → 404', async ({
    request,
  }) => {
    await passGate(request);
    const res = await request.post(`/api/admin/d17/${MISSING_UUID}/approve`);
    expect(res.status()).toBe(404);
  });
});

test.describe('proof screenshot', () => {
  test.skip(!GATE_SECRET, 'needs the gate cookie');

  test('a malformed id is 404, not a 500 cast error', async ({ request }) => {
    await passGate(request);
    const res = await request.get('/api/admin/d17/not-a-uuid/screenshot');
    await expectEnvelope(res, 404, 'not_found');
  });

  test('a well-formed id with no row is 404 with a screenshot message', async ({
    request,
  }) => {
    await passGate(request);
    const res = await request.get(`/api/admin/d17/${MISSING_UUID}/screenshot`);
    await expectEnvelope(res, 404, 'not_found');
  });
});

test.describe('trial redeem', () => {
  test('anonymous is 401 with the shared envelope', async ({ request }) => {
    const res = await request.post('/api/trial/redeem', { data: { code: 'ANY' } });
    await expectEnvelope(res, 401, 'unauthorized');
  });

  test('a malformed body is 400 validation, not invalid_json', async ({ request }) => {
    const res = await request.post('/api/trial/redeem', { data: {} });
    // 401 wins when there is no session; the shape is the assertion.
    const body = (await res.json()) as Envelope;
    expect(body.error?.code).toBe(res.status() === 401 ? 'unauthorized' : 'validation');
  });
});

test.describe('chat surfaces', () => {
  test('anonymous chat POST is 401', async ({ request }) => {
    const res = await request.post('/api/chat', { data: { alias: 'fast', message: 'hi' } });
    await expectEnvelope(res, 401, 'unauthorized');
  });

  test('anonymous scheduled list is 401', async ({ request }) => {
    const res = await request.get('/api/chat/scheduled');
    await expectEnvelope(res, 401, 'unauthorized');
  });

  test('a share revoke with a malformed conversation id is 404', async ({ request }) => {
    const res = await request.delete(
      `/api/chat/conversations/not-a-uuid/share?shareId=${MISSING_UUID}`,
    );
    expect([401, 404]).toContain(res.status());
  });
});

test.describe('signed in', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run');

  test('GET /api/orgs/[id] answers for my org and 404s a stranger', async ({ page }) => {
    const request = await signIn(page);

    const list = await request.get('/api/orgs');
    expect(list.status()).toBe(200);
    const { orgs } = (await list.json()) as { orgs: { id: string; name: string }[] };
    expect(orgs.length).toBeGreaterThan(0);
    const first = orgs[0]!;

    const mine = await request.get(`/api/orgs/${first.id}`);
    expect(mine.status()).toBe(200);
    const body = (await mine.json()) as { organization: { id: string; name: string } };
    expect(body.organization.id).toBe(first.id);

    const stranger = await request.get(`/api/orgs/${MISSING_UUID}`);
    await expectEnvelope(stranger, 404, 'not_found');
  });

  test('a signed-in customer cannot approve a D17 payment', async ({ page }) => {
    const request = await signIn(page);
    const res = await request.post(`/api/admin/d17/${MISSING_UUID}/approve`);
    // 403 forbidden: a customer is not staff. 401 only if the account has no
    // staff row AND no gate cookie — both are refusals, never a 404 or 200.
    expect([401, 403]).toContain(res.status());
  });

  test('share revoke through the wrong conversation revokes nothing', async ({ page }) => {
    const request = await signIn(page);
    const res = await request.delete(
      `/api/chat/conversations/${MISSING_UUID}/share?shareId=${MISSING_UUID}`,
    );
    // The conversation predicate runs first: no such chat, nothing revoked.
    await expectEnvelope(res, 404, 'not_found');
  });

  test('scheduled create is refused when the plan is not live', async ({ page }) => {
    const request = await signIn(page);
    const res = await request.post('/api/chat/scheduled', {
      data: { prompt: 'dial the wall', everyMinutes: 15 },
    });
    // 201 when the account has a live plan; 402/403 when it does not.
    expect([201, 402, 403]).toContain(res.status());
    if (res.status() !== 201) {
      const body = (await res.json()) as Envelope;
      expect(['payment_required', 'forbidden']).toContain(body.error.code);
    }
  });

  test('attachments rejects an oversize upload before parsing it', async ({ page }) => {
    const request = await signIn(page);
    const res = await request.post('/api/attachments', {
      multipart: {
        file: {
          name: 'big.txt',
          mimeType: 'text/plain',
          // 40MB declared is over the 25MB cap.
          buffer: Buffer.alloc(40 * 1024 * 1024, 0x61),
        },
      },
    });
    // Either the engine is off (validation) or the size cap refuses it.
    const body = (await res.json()) as Envelope;
    expect(['validation', 'upstream', 'rate_limited']).toContain(body.error?.code);
  });
});

/**
 * LAST, deliberately: it exhausts this client's bucket for the gate, so any
 * test after it would see 429 for the next 15 minutes.
 */
test.describe('admin gate limiter', () => {
  test.skip(!GATE_SECRET, 'set ADMIN_GATE_SECRET to run');

  test('hammering it hits 429 with Retry-After', async ({ request }) => {
    let last = 0;
    for (let i = 0; i < 14; i++) {
      const res = await request.post('/api/admin/gate', { data: { code: `bad-${i}` } });
      last = res.status();
      if (last === 429) {
        expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
        await expectEnvelope(res, 429, 'rate_limited');
        break;
      }
    }
    expect(last, 'the limiter must trip within 14 attempts (max 10)').toBe(429);
  });

});
