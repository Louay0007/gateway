/**
 * GET /api/agent/d17/queue — what the agent should look at, with proof bytes.
 *
 * WHY NOT REUSE /api/admin/d17. That route is a browser surface: it answers
 * with what a page renders, gated by a cookie and a staff session neither of
 * which n8n has. It also returns one shape for one screen. This endpoint
 * returns exactly what the workflow needs in one call — the invoice values
 * to compare against AND the screenshot base64 — so a run costs one HTTP
 * request per payment instead of a list, then a fetch per screenshot.
 *
 * WHAT IT DELIBERATELY WITHHOLDS. No customer name, no email, no org
 * contact. The agent compares numbers; it never needs to know who. A token
 * that leaks can therefore read a queue of amounts and phone numbers, which
 * is already public to the payer's own receipt, and not a customer list.
 *
 * KEY CONTRACT. Each item carries `expected`, which is the ONLY source of
 * truth the workflow should send back in a reading. If the workflow instead
 * reads the amount from the image and compares it itself, it reproduces
 * `scoreVerification()` in n8n and the two copies drift. The amount it must
 * match is handed to it; the server re-checks anyway.
 */

import { requireAgentToken, serviceAuthResponse, ServiceAuthError } from '@/lib/billing/d17-agent-auth';
import { readProofScreenshot } from '@/lib/billing/d17-verify-service';
import { listVerificationQueue } from '@/lib/billing/d17-verify-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    requireAgentToken(request);

    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? '10') || 10));
    const screenshots = url.searchParams.get('screenshots') !== 'false';

    const rows = await listVerificationQueue(['proof_submitted'], limit);

    // A row whose file is missing would make the workflow fail one payment
    // at a time with an opaque 500 from a vision call. Surface it here as
    // `screenshot: null` and let the workflow skip it — staff still see the
    // payment in their own queue, which is where a missing file belongs.
    const items = await Promise.all(
      rows.map(async (r) => ({
        paymentId: r.paymentId,
        ageHours: r.ageHours,
        expiresAt: r.expiresAt,
        flaggedReview: r.flaggedReview,
        expected: {
          amount: r.amount,
          amountMillimes: r.amountMillimes,
          authorizationNumber: r.authorizationNumber,
          senderPhone: r.senderPhone,
        },
        previous: r.verdict
          ? { verdict: r.verdict, score: r.score, blockedBy: r.blockedBy, at: r.verifiedAt }
          : null,
        screenshot: screenshots ? await readProofScreenshot(r.paymentId) : null,
      })),
    );

    return Response.json(
      { count: items.length, items },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof ServiceAuthError) return serviceAuthResponse(e);
    throw e;
  }
}
