/**
 * Alias labels — the only names a customer ever sees.
 *
 * Kept out of the picker component so the same three strings can label the
 * sidebar, the quota meter and the per-message footer without drifting.
 *
 * "PROVIDED BY" IS TIER PROVENANCE, NOT A LIVE MODEL LOOKUP.
 *
 * An alias maps to whatever upstream model currently serves that tier
 * (lib/pricing/alias.ts reads prices/models.yaml). Naming the model that
 * happens to sit behind the tier today is the coupling that note forbids:
 * a customer who builds against `smart = X` turns a routine model swap into
 * a breaking change and a support thread.
 *
 * So `provider` names the Zaino tier the alias is served from — a brand
 * promise that stays true after the model behind it changes. `blurb` states
 * the capability in plain language. If the upstream for `smart` changes
 * tomorrow, every string here is still correct; that is the test they have
 * to pass.
 */
import type { TierAlias } from '@/lib/pricing/alias';

export interface AliasMeta {
  alias: TierAlias;
  label: string;
  /** The Zaino tier this alias is served from. Shown as "provided by …". */
  provider: string;
  blurb: string;
}

export const ALIAS_META: Record<TierAlias, AliasMeta> = {
  fast: {
    alias: 'fast',
    label: 'Fast',
    provider: 'Zaino Lite',
    blurb: 'Quick answers for short questions and simple edits.',
  },
  smart: {
    alias: 'smart',
    label: 'Smart',
    provider: 'Zaino Pro',
    blurb: 'Balanced reasoning and speed — the right default for most work.',
  },
  frontier: {
    alias: 'frontier',
    label: 'Frontier',
    provider: 'Zaino Max',
    blurb: 'Deepest reasoning for hard problems. Slower, and the most costly.',
  },
  fable: {
    alias: 'fable',
    label: 'Fable',
    provider: 'Zaino Ultra',
    blurb: 'The longest-horizon tier — for whole-task runs and multi-step agents.',
  },
};

export const ALIAS_ORDER: TierAlias[] = ['fast', 'smart', 'frontier', 'fable'];

export function aliasMeta(alias: string): { label: string; provider: string; blurb: string } {
  const meta = ALIAS_META[alias as TierAlias];
  // An alias we do not have copy for still renders as the alias itself.
  // Guessing a prettier name is how an upstream model name leaks.
  return meta ?? { label: alias, provider: alias, blurb: '' };
}
