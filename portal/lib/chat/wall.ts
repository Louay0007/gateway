/**
 * The plan wall, in one place.
 *
 * `/api/chat` cuts every spending surface the same way: no plan → 402,
 * budget spent → 403, alias not allowed → 403. Scheduled prompts are
 * automatic turns, so they hit the identical wall — spelled once here so
 * the routes and the job cannot drift into disagreeing about what a
 * customer may spend.
 */
import { jsonError } from '@/lib/api/errors';
import type { ApiErrorCode } from '@/lib/api/errors';
import type { AllowedModelsResult } from '@/lib/entitlements/allowed-models';

export interface WallReason {
  code: ApiErrorCode;
  message: string;
}

/** Why this turn is refused, or null when it may proceed. */
export function wallReason(
  wall: AllowedModelsResult,
  alias?: string,
): WallReason | null {
  if (wall.allowed.length === 0) {
    // Two different refusals wear the same status, and conflating them is
    // the bug that makes a paying customer think their plan is broken.
    return wall.entitled.length === 0
      ? { code: 'payment_required', message: 'Choose a plan to start chatting.' }
      : {
          code: 'forbidden',
          message:
            'You have used your token budget for this period. It resets automatically — you can see when under Settings → Usage.',
        };
  }
  if (alias && !wall.allowed.includes(alias)) {
    return {
      code: 'forbidden',
      message: 'That model is not available on your plan right now. Pick another from the list.',
    };
  }
  return null;
}

/** A refusal Response, or null when the caller may proceed. */
export function wallRefusal(
  wall: AllowedModelsResult,
  alias?: string,
): Response | null {
  const reason = wallReason(wall, alias);
  return reason ? jsonError(reason.code, reason.message) : null;
}
