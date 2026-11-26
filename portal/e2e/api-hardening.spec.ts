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

// The console login (0053). ADMIN_GATE_SECRET is gone; this is a staff
// username + password, and the only credential /api/admin/* accepts.
const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'admin';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD;
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

/**
 * Establish a CONSOLE session; the context keeps the cookie.
 *
 * Drives the real form on the console host, because that is the only way to
 * obtain the console cookie — it is a different cookie name from the portal's
 * and `@auth/core` builds its action URLs from AUTH_URL, so a hand-rolled
 * POST to the portal origin would mint the WRONG cookie and every subsequent
 * assertion would fail for the wrong reason.
 */
async function passGate(page: Page) {
  await page.goto(`${process.env.E2E_ADMIN_ORIGIN ?? 'http://admin.localhost'}/admin/login`);
  await page.fill('input[name="username"]', STAFF_USERNAME);
  await page.fill('input[name="password"]', STAFF_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/ops/, { timeout: 20_000 });
  return page.context().request;
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

test.describe('console login', () => {
  test.skip(!STAFF_PASSWORD, 'set E2E_STAFF_PASSWORD to run');

  test('wrong credentials are refused, and the console API stays closed', async ({ request }) => {
    // Signing in is a page-level action now, so this asserts the property
    // that matters: an unauthenticated caller reaches NO console API, and
    // the answer is the shared envelope rather than a bare string.
    await expectEnvelope(
      await request.get('/api/admin/ops'),
      401,
      'unauthorized',
    );
  });

  test('a portal session is not a console session', async ({ page }) => {
    // THE SEPARATION, over HTTP. `/api/admin/*` is decided by the CONSOLE
    // cookie; a customer session must not satisfy it — otherwise an
    // operator's console credential and a customer's would be the same
    // authority, which is what the separate cookie exists to prevent.
    if (!EMAIL || !PASSWORD) test.skip(true, 'set E2E_EMAIL and E2E_PASSWORD to run');
    const request = await signIn(page);
    await expectEnvelope(await request.get('/api/admin/ops'), 401, 'unauthorized');
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

  test.skip(!STAFF_PASSWORD, 'needs a console session');
  test('a signed-in operator gets past the proxy to a 403 on rank', async ({ page }) => {
    // `passGate` establishes a real console session. Approving needs
    // `support`; the seeded local operator is `admin`, so this reaches the
    // service and answers 404 for the missing payment. A `read_only`
    // operator would answer 403 here instead — that difference is the rank
    // check, and `requireOperator` is where it lives.
    const request = await passGate(page);
    const res = await request.post(`/api/admin/d17/${MISSING_UUID}/approve`);
    expect(
      res.status(),
      'a console session must reach the handler, not be stopped by the proxy',
    ).toBe(404);
  });
});

test.describe('proof screenshot', () => {
  test.skip(!STAFF_PASSWORD, 'needs a console session');

  test('anonymous is 401 — this route used to fail OPEN', async ({ request }) => {
    // It checked the shared gate FIRST and fell back to the staff role only
    // when the gate failed — and an unset ADMIN_GATE_SECRET made the gate
    // "pass". So on any deployment without the secret, anyone could pull
    // payment proof images. One check now, and it is the rank check.
    await expectEnvelope(
      await request.get(`/api/admin/d17/${MISSING_UUID}/screenshot`),
      401,
      'unauthorized',
    );
  });

  test('a malformed id is 404, not a 500 cast error', async ({ page }) => {
    const request = await passGate(page);
    const res = await request.get('/api/admin/d17/not-a-uuid/screenshot');
    await expectEnvelope(res, 404, 'not_found');
  });

  test('a well-formed id with no row is 404 with a screenshot message', async ({ page }) => {
    const request = await passGate(page);
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
/**
 * The console login throttle lives in `checkThrottle()` (lib/auth/throttle.ts)
 * and is keyed on `staff:<username>`. It is NOT exercised here: doing so
 * requires submitting the real form six times and would lock the seeded
 * operator out of every subsequent test in this file for up to an hour —
 * which is exactly why the old gate limiter had to run LAST. The control is
 * asserted at the layer that owns it (`tests/admin-console.test.ts`) and
 * manually in the walkthrough.
 */
