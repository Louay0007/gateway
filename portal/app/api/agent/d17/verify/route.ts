/**
 * POST /api/agent/d17/verify — record a reading of one proof, approve if earned.
 *
 * THE CALLER DOES NOT DECIDE. n8n sends what the model claims it READ off the
 * screenshot; `scoreVerification()` compares those fields against the payment
 * row and only a `pass` can auto-approve, and only when this deployment opted
 * in with `D17_VERIFY_AUTO_APPROVE=true`. There is deliberately no `verdict`
 * or `approve` field in the request body: adding one would make this endpoint
 * an unauthenticated-by-argument money switch the moment a workflow is edited
 * by someone who does not know what the fields mean.
 *
 * 200 is returned for every reading that was recorded, whatever the verdict —
 * a `fail` is a successful call. A 4xx means the reading was not recorded.
 */

import { z } from 'zod';
import { requireAgentToken, serviceAuthResponse, ServiceAuthError } from '@/lib/billing/d17-agent-auth';
import { verifyD17Proof } from '@/lib/billing/d17-verify-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The reading. Every field nullable, because "the model could not read this"
 * is a real and common outcome that must be representable — a schema that
 * required a string would force the workflow to invent one, and an invented
 * authorization number is the single worst input this endpoint can receive.
 */
const reading = z.object({
  amount: z.string().max(64).nullable().default(null),
  authNumber: z.string().max(128).nullable().default(null),
  senderPhone: z.string().max(64).nullable().default(null),
  receiverPhone: z.string().max(64).nullable().default(null),
  date: z.string().max(64).nullable().default(null),
});

const body = z.object({
  paymentId: z.string().regex(UUID),
  extracted: reading,
  /** Reported by the workflow so cost and model attribution survive. */
  model: z.string().max(128).optional(),
  inputTokens: z.number().int().nonnegative().nullable().optional(),
  outputTokens: z.number().int().nonnegative().nullable().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireAgentToken(request);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: 'Body is not JSON' }, { status: 400 });
    }

    const parsed = body.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid reading', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 },
      );
    }

    const { paymentId, extracted, model, inputTokens, outputTokens } = parsed.data;

    // The reading is stored verbatim and normalized only at comparison time,
    // so the evidence row shows what the model actually said.
    const result = await verifyD17Proof({
      paymentId,
      extracted,
      model,
      inputTokens,
      outputTokens,
    });

    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 409;
      const message = {
        not_found: 'No such payment.',
        not_submitted: 'Payment is not waiting on a proof (already decided).',
        no_screenshot: 'Payment has no screenshot on file.',
      }[result.error ?? 'not_found'];
      return Response.json({ error: message, code: result.error }, { status });
    }

    return Response.json(
      {
        ok: true,
        approved: result.approved ?? false,
        verdict: result.decision?.verdict,
        score: result.decision?.score,
        checks: result.decision?.checks,
        blockedBy: result.blockedBy,
        reason: result.decision?.reason,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof ServiceAuthError) return serviceAuthResponse(e);
    throw e;
  }
}
