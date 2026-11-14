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
 * These are the numbers the DATABASE holds (migrations 0037 price, 0039
 * pool). Anything that disagrees with this file is wrong, and
 * tests/pricing-facts.test.ts checks it against the shipping migrations.
 */

export interface PlanFacts {
  code: "starter" | "pro";
  name: string;
  /** One line: who this is for. Competitors all do this; it converts. */
  forWhom: string;
  priceUsdCents: number;
  priceTndMillimes: number;
  /** Shared monthly token pool. Same for both plans, by decision. */
  poolTokens: number;
  poolLabel: string;
  models: string[];
  maxKeys: number;
  maxSeats: number;
  /** What actually differs between the plans, in the buyer's words. */
  headline: string;
}

export const PLAN_FACTS: PlanFacts[] = [
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
    maxSeats: 1,
    headline: "Everything you need to start",
  },
  {
    code: "pro",
    name: "Pro",
    forWhom: "For work that needs the strongest reasoning, with a team around it.",
    priceUsdCents: 3000,
    priceTndMillimes: 90000,
    poolTokens: 50_000_000,
    poolLabel: "50M",
    models: ["smart", "frontier", "fable"],
    maxKeys: 15,
    maxSeats: 25,
    headline: "The strongest models, and a team",
  },
];

/** Per-alias list rates, dollars per million blended tokens. */
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
 */
export const COMPARISON: {
  group: string;
  rows: { label: string; starter: string; pro: string }[];
}[] = [
  {
    group: "Usage",
    rows: [
      { label: "Shared token pool", starter: "50M / month", pro: "50M / month" },
      { label: "Spendable on any included model", starter: "Yes", pro: "Yes" },
      { label: "Per-model token ceiling", starter: "None", pro: "None" },
      { label: "Reset", starter: "Monthly", pro: "Monthly" },
      { label: "Failed requests billed", starter: "Never", pro: "Never" },
    ],
  },
  {
    group: "Models",
    rows: [
      { label: "Fast", starter: "Yes", pro: "—" },
      { label: "Smart", starter: "Yes", pro: "Yes" },
      { label: "Frontier", starter: "—", pro: "Yes" },
      { label: "Fable", starter: "—", pro: "Yes" },
      { label: "Context window", starter: "1M", pro: "1M" },
      { label: "Max output", starter: "64k", pro: "64k" },
    ],
  },
  {
    group: "Team",
    rows: [
      { label: "API keys", starter: "3", pro: "15" },
      { label: "Seats", starter: "1", pro: "25" },
      { label: "Priority support", starter: "—", pro: "Yes" },
    ],
  },
  {
    group: "Payment",
    rows: [
      { label: "D17 transfer (Tunisia)", starter: "Yes", pro: "Yes" },
      { label: "Card", starter: "Yes", pro: "Yes" },
      { label: "Trial", starter: "3 days, no card", pro: "3 days, no card" },
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
    q: "What happens when I reach 50M?",
    a: "Every model on the plan pauses until the period ends — there is no per-model ceiling to hit first. You see the reset date on the dashboard, and an upgrade takes effect immediately.",
  },
  {
    q: "Is 50M per model or in total?",
    a: "In total. One pool, spendable in any proportion: 30M on smart and 20M on frontier, 10M and 40M, or all 50M on a single model.",
  },
  {
    q: "Why do Starter and Pro cost different prices for the same pool?",
    a: "Because the pool is the same but the models are not. Pro unlocks frontier and fable, which are the most expensive engines, and adds 15 keys and 25 seats. Volume is not the difference and we would rather say so than invent a number.",
  },
  {
    q: "Which plan should I pick?",
    a: "If you are one developer calling fast or smart, Starter. If you need the deepest reasoning, or more than one person needs keys, Pro. You can change plan at any time and the difference is prorated by the billing period.",
  },
  {
    q: "How do I pay from Tunisia?",
    a: "A D17 transfer at any La Poste counter, verified by a person — usually within hours. Prices in dinars are shown alongside the dollar price, and neither is derived from a floating rate at checkout.",
  },
  {
    q: "Can I pay by card?",
    a: "Yes, at checkout, in US dollars. Card payments are instant.",
  },
  {
    q: "Do you offer annual billing or invoices?",
    a: "Monthly is what the product charges today. If you need a company invoice with your details, write to us and we will issue one by hand — that is honest about where we are.",
  },
];
