/**
 * Billing — the provider-agnostic subscription contract.
 *
 * DECISION (2026-10-11): subscriptions do NOT go through Stripe. The
 * payment provider is being finalised (referred to internally as D17);
 * until it is, `DevBillingProvider` exercises the identical lifecycle so
 * the MVP is end-to-end working today.
 *
 * That means every provider-specific fact — payment intents, redirect
 * URLs, callback signatures, cancellation semantics — lives BEHIND this
 * interface. Wiring D17 later is one new file plus one env var; nothing
 * in the lifecycle service, the routes, the key gating, or the metering
 * proof changes. That boundary is the whole point of this module.
 *
 * What is provider-neutral and therefore ours to own:
 *   - the subscription state machine (`lib/billing/service.ts`)
 *   - entitlement enforcement (already proven, `lib/entitlements/`)
 *   - webhook idempotency (`billing_events`, PLATFORM.md §6.2's replay
 *     rule, provider-neutral since 0003)
 */

/** Lifecycle events a provider can report. */
export type ProviderEventKind =
  /** Payment succeeded; the subscription is live. */
  | 'subscription.activated'
  /** A renewal payment failed. Access continues (grace period). */
  | 'subscription.payment_failed'
  /** The customer cancelled, or the provider gave up on retries. */
  | 'subscription.canceled';

export interface CheckoutIntent {
  /** Provider-side handle (payment id / session id). */
  providerReference: string;
  /** Where the user completes payment. */
  checkoutUrl: string;
  /** The local subscription row this intent activates. */
  subscriptionId: string;
  expiresAt: string;
}

/**
 * A verified, normalised provider callback.
 *
 * `id` is the provider's event id and the `billing_events` dedupe key —
 * a replayed callback must never apply twice (PLATFORM.md §6.2).
 * `organizationId` is resolved by the provider from what IT put in the
 * payment metadata; the portal never trusts an org id in the body.
 */
export interface ProviderEvent {
  id: string;
  kind: ProviderEventKind;
  providerReference: string;
  organizationId: string;
  planCode?: string;
  periodEnd?: string;
  failureReason?: string;
}

export interface BeginCheckoutInput {
  organizationId: string;
  planCode: string;
  /** The subscription row the intent activates (created by the service). */
  subscriptionId: string;
  /** Where the provider returns the user after payment. */
  returnUrl: string;
}

export interface BillingProvider {
  readonly name: 'dev' | 'd17';

  /** Create the provider-side payment and return where the user pays. */
  begin(input: BeginCheckoutInput): Promise<CheckoutIntent>;

  /**
   * Verify a callback's signature over the RAW body and normalise it.
   * Throws on a bad signature — the route answers 400 and writes
   * nothing. Parsing before verifying loses the bytes and is the bug
   * this exists to prevent (PLATFORM.md §6.2).
   */
  verify(rawBody: string, headers: Record<string, string | null>): Promise<ProviderEvent>;

  /** Cancel at the provider. Called before the local row flips. */
  cancel(input: {
    organizationId: string;
    providerSubscriptionId: string | null;
  }): Promise<void>;
}
