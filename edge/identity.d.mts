/**
 * Types for identity.mjs.
 *
 * Same reason as upstream-guard.d.mts: the edge is plain Node ESM with no build
 * step, and `tsc --noEmit` is part of the deploy gate. Kept to what the module
 * actually exports.
 */

export interface ModelIdentity {
  /** Customer-facing product name, e.g. "Zaino AI Fast". */
  product: string;
  /** What actually serves the tier, e.g. "Haiku 5.5". */
  engine: string;
}

export type TierAlias = 'fast' | 'smart' | 'frontier' | 'fable';

export declare const IDENTITIES: Record<TierAlias, ModelIdentity>;
export declare const TIER_ALIASES: TierAlias[];
export declare const ENGINE_TO_TIER: Record<string, TierAlias>;

export declare function bareModelName(model: string): string;
export declare function identityFor(alias: string | null | undefined): ModelIdentity | null;
export declare function identityLine(alias: string | null | undefined): string | null;
export declare function identityPrompt(alias: string | null | undefined): string | null;

export declare function withIdentity(
  existing: string | null | undefined,
  alias: string | null | undefined,
): string | null;
export declare function alreadyHasIdentity(
  existing: string | null | undefined,
  alias: string | null | undefined,
): boolean;

export declare function isIdentityQuestion(text: string): boolean;
export declare function repairIdentityAnswer(
  answer: string,
  alias: string | null | undefined,
  askedIdentity: boolean,
): string | null;

/** Loosely typed on purpose: the edge walks arbitrary request bodies. */
export interface IdentityApplyResult {
  body: any;
  changed: boolean;
}

export declare function applyChatIdentity(body: any, alias: string | null | undefined): IdentityApplyResult;
export declare function applyMessagesIdentity(body: any, alias: string | null | undefined): IdentityApplyResult;
export declare function applyResponsesIdentity(body: any, alias: string | null | undefined): IdentityApplyResult;
export declare function lastUserText(body: any, dialect: 'chat' | 'messages' | 'responses'): string;
