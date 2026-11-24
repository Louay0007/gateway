/**
 * Pricing facts — one place the public pages and the paywall agree.
 *
 * WHY. The pricing page, the landing preview, the docs TOC and the dashboard
 * paywall each stated plan numbers independently, and they drifted: at
 * different times this repo advertised 59/307 DT, 80M/32M tokens, a Pro
 * volume advantage Pro does not have, and a Halloween discount two weeks
 * after it expired. A buyer comparing three numbers on one page does not
 * conclude "a stale component" — they conclude we are careless with money.
 *
 * These are the numbers the DATABASE holds (migrations 0037 price, 0046
 * ladder). Anything that disagrees with this file is wrong, and
 * tests/pricing-facts.test.ts checks it against the shipping migrations.
 */

/** Every plan a customer can buy. The hidden trial plan is not one. */
export const PLAN_CODES = ["solo", "starter", "pro", "team", "business"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanFacts {
  code: PlanCode;
  name: string;
  /** One line: who this is for. Competitors all do this; it converts. */
  forWhom: string;
  priceUsdCents: number;
  priceTndMillimes: number;
  /** Shared monthly pool, in WEIGHTED units — not raw tokens. */
  poolTokens: number;
  poolLabel: string;
  models: string[];
  maxKeys: number;
  /** What actually differs between the plans, in the buyer's words. */
  headline: string;
}

export const PLAN_FACTS: PlanFacts[] = [
  {
    code: "solo",
    name: "Solo",
    forWhom: "For one developer who wants the strong models without a company budget.",
    priceUsdCents: 1300,
    priceTndMillimes: 39000,
    // 35M, not the 40M the pricing model proposed: 40M/39 DT is 1,026k per
    // dinar against Starter's 1,000k, which makes Starter the irrational
    // choice and kills the tier above. 35M is 897k — a real discount on
    // entry price that is still visibly worse per dinar.
    poolTokens: 35_000_000,
    poolLabel: "35M",
    models: ["fast", "smart"],
    maxKeys: 2,
    headline: "The cheapest way onto smart",
  },
  {
    code: "starter",
    name: "Starter",
    forWhom: "For a developer shipping side projects and everyday agent work.",
    priceUsdCents: 1500,
    priceTndMillimes: 50000,
    poolTokens: 50_000_000,
    poolLabel: "50M",
    models: ["fast", "smart"],
    maxKeys: 3,
    headline: "Everything you need to start",
  },
  {
    code: "pro",
    name: "Pro",
    forWhom: "For work that needs the strongest reasoning, on the frontier and fable models.",
    priceUsdCents: 3000,
    priceTndMillimes: 90000,
    poolTokens: 50_000_000,
    poolLabel: "50M",
    models: ["smart", "frontier", "fable"],
    maxKeys: 15,
    headline: "The strongest models, and a team",
  },
  {
    code: "team",
    name: "Team",
    forWhom: "For a team that each needs the strongest models, on one invoice.",
    priceUsdCents: 8000,
    priceTndMillimes: 250000,
    poolTokens: 150_000_000,
    poolLabel: "150M",
    models: ["smart", "frontier", "fable"],
    maxKeys: 30,
    headline: "Three times the pool, on one invoice",
  },
  {
    code: "business",
    name: "Business",
    forWhom: "For a company rolling AI out across teams, with finance in the loop.",
    priceUsdCents: 16000,
    priceTndMillimes: 500000,
    poolTokens: 400_000_000,
    poolLabel: "400M",
    models: ["smart", "frontier", "fable"],
    maxKeys: 100,
    headline: "Company-wide, with an audit trail",
  },
];

/** The card the page emphasises. Pro carries the best margin per block. */
export const FEATURED_PLAN: PlanCode = "pro";

/**
 * Per-alias list rates, dollars per million blended tokens.
 *
 * These are the RETAIL rates the shop window quotes, not the operator's
 * wholesale cost (0.20 DT per 1M — see PRICING-MODEL-2026-11.md). Do not
 * "fix" this table from a supplier invoice.
 */
export const RATES: {
  alias: string;
  input: number;
  output: number;
  cacheRead: number;
  note: string;
}[] = [
  { alias: "fast", input: 1.0, output: 5.0, cacheRead: 0.1, note: "cheapest, high volume" },
  { alias: "smart", input: 3.0, output: 15.0, cacheRead: 0.3, note: "the everyday default" },
  { alias: "frontier", input: 15.0, output: 75.0, cacheRead: 1.5, note: "deepest reasoning" },
  { alias: "fable", input: 15.0, output: 75.0, cacheRead: 1.5, note: "long-horizon agents" },
];

/**
 * The comparison table, GROUPED BY JOB rather than alphabetically.
 *
 * Rows are what a buyer asks in order: what do I get, what can I call, what
 * do I pay, and how does my team use it. A flat list of features is a
 * brochure; this is a decision.
 *
 * Values are keyed by plan code rather than one field per plan, because a
 * field per plan is what rotted the last time: adding a third tier meant
 * editing every row and the compiler could not tell you which one you
 * missed. A Record forces every row to answer for every plan, and
 * tests/pricing-facts.test.ts checks that none is empty.
 */
export const COMPARISON: {
  group: string;
  rows: { label: string; values: Record<PlanCode, string> }[];
}[] = [
  {
    group: "Usage",
    rows: [
      {
        label: "Shared token pool",
        values: {
          solo: "35M / month",
          starter: "50M / month",
          pro: "50M / month",
          team: "150M / month",
          business: "400M / month",
        },
      },
      {
        label: "Spendable on any included model",
        values: { solo: "Yes", starter: "Yes", pro: "Yes", team: "Yes", business: "Yes" },
      },
      {
        label: "Per-model token ceiling",
        values: { solo: "None", starter: "None", pro: "None", team: "None", business: "None" },
      },
      {
        label: "Reset",
        values: { solo: "Monthly", starter: "Monthly", pro: "Monthly", team: "Monthly", business: "Monthly" },
      },
      {
        label: "Failed requests billed",
        values: { solo: "Never", starter: "Never", pro: "Never", team: "Never", business: "Never" },
      },
    ],
  },
  {
    group: "Models",
    rows: [
      {
        label: "Fast",
        values: { solo: "Yes", starter: "Yes", pro: "—", team: "—", business: "—" },
      },
      {
        label: "Smart",
        values: { solo: "Yes", starter: "Yes", pro: "Yes", team: "Yes", business: "Yes" },
      },
      {
        label: "Frontier",
        values: { solo: "—", starter: "—", pro: "Yes", team: "Yes", business: "Yes" },
      },
      {
        label: "Fable",
        values: { solo: "—", starter: "—", pro: "Yes", team: "Yes", business: "Yes" },
      },
      {
        label: "Context window",
        values: { solo: "1M", starter: "1M", pro: "1M", team: "1M", business: "1M" },
      },
      {
        label: "Max output",
        values: { solo: "64k", starter: "64k", pro: "64k", team: "64k", business: "64k" },
      },
    ],
  },
  {
    group: "Team",
    rows: [
      {
        label: "API keys",
        values: { solo: "2", starter: "3", pro: "15", team: "30", business: "100" },
      },
      {
        label: "Priority support",
        values: { solo: "—", starter: "—", pro: "Yes", team: "Yes", business: "Yes" },
      },
    ],
  },
  {
    group: "Payment",
    rows: [
      {
        label: "D17 transfer (Tunisia)",
        values: { solo: "Yes", starter: "Yes", pro: "Yes", team: "Yes", business: "Yes" },
      },
      {
        // Honest, not aspirational: only Starter and Pro have a card product
        // in the processor (migration 0040). A "Yes" here would be a broken
        // checkout button, which is worse than a dash.
        label: "Card",
        values: { solo: "—", starter: "Yes", pro: "Yes", team: "—", business: "—" },
      },
      {
        label: "Trial",
        values: {
          solo: "3 days, no card",
          starter: "3 days, no card",
          pro: "3 days, no card",
          team: "3 days, no card",
          business: "3 days, no card",
        },
      },
    ],
  },
];

/**
 * The FAQ under pricing. Competitors all run one, and the trust questions
 * are the ones that close an aggregator sale — answered in the negative,
 * because "we do not mark up" is the only credible form of that claim.
 */
export const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: "Do you mark up the token prices?",
    a: "No. The per-million rates on this page are the rates you are charged. Our margin comes from buying capacity in bulk, not from padding your line items.",
  },
  {
    q: "Are failed requests billed?",
    a: "No. Only successful inference calls are metered. A timeout, a 429 or a refused request never consumes your pool.",
  },
  {
    q: "What happens when I reach my pool?",
    a: "Every model on the plan pauses until the period ends — there is no per-model ceiling to hit first. You see the reset date on the dashboard, and an upgrade takes effect immediately.",
  },
  {
    q: "Is the pool per model or in total?",
    a: "In total, and it is counted in blended units rather than raw tokens: a fast token counts a third, a smart token one, a frontier or fable token five. So Starter's 50M is 150M fast tokens, 50M smart, or 10M frontier — spend it in any mix.",
  },
  {
    q: "Why do Starter and Pro cost different prices for the same pool?",
    a: "Because the pool is the same but the models are not. Pro unlocks frontier and fable, which are the most expensive engines, and adds 15 API keys. Volume is not the difference and we would rather say so than invent a number.",
  },
  {
    q: "Which plan should I pick?",
    a: "One developer calling fast or smart: Solo at 39 DT, or Starter at 50 DT if you want the extra 10M and an extra key. You need frontier or fable: Pro. A team needing frontier-class models for several people: Team, which carries three times Pro's pool for one invoice.",
  },
  {
    q: "Can I pay by card on every plan?",
    a: "Card checkout is live for Starter and Pro. Solo, Team and Business are sold on the D17 rail for now — write to us and we will send a card link or a bank invoice by hand rather than leave a button that fails.",
  },
  {
    q: "How do I pay from Tunisia?",
    a: "A D17 transfer at any La Poste counter, verified by a person — usually within hours. Prices in dinars are shown alongside the dollar price, and neither is derived from a floating rate at checkout.",
  },
  {
    q: "Do you offer annual billing or invoices?",
    a: "Monthly is what the product charges today. If you need a company invoice with your details, write to us and we will issue one by hand — that is honest about where we are.",
  },
];
