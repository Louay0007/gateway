import { KeyRound, Layers, LineChart, ShieldCheck, Wallet, Zap } from 'lucide-react';

/**
 * Feature grid — the six things that are actually true of the product
 * (each maps to something proven by the proofs: `make verify-metering`
 * and `make verify-d17`). Marketing copy that invents capabilities the
 * backend cannot demonstrate is the first thing a technical buyer tests.
 */

const features = [
  {
    icon: Layers,
    title: 'One API, two wire formats',
    body: 'OpenAI-compatible /v1/chat/completions and Anthropic-compatible /v1/messages — point your existing SDK at one base URL.',
  },
  {
    icon: ShieldCheck,
    title: 'Spend ceilings that hold',
    body: 'Every plan carries a hard cap enforced at the gateway. Over the ceiling you get a clean 429, not a surprise invoice.',
  },
  {
    icon: KeyRound,
    title: 'Keys in seconds',
    body: 'Create a key from the dashboard, see the value once, and start calling. Revoking is upstream-first and instant.',
  },
  {
    icon: LineChart,
    title: 'Usage you can audit',
    body: 'Every request is a ledger row: tokens by class, cost, model, and status — reconciled against your plan rate.',
  },
  {
    icon: Wallet,
    title: 'Pay the way Tunisia pays',
    body: 'Subscribe with a D17 transfer (La Poste). D17 payments are verified by a human within hours, not by a webhook.',
  },
  {
    icon: Zap,
    title: 'Eleven models, three tiers, zero routing to configure',
    body: 'Ask for fast, smart, or frontier. Every alias load-balances across several models behind it, so a rate-limited pool is skipped instead of failing your request — with streaming, retries and cooldowns handled for you.',
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-gray-200/60 dark:border-gray-800 py-20 sm:py-28 bg-white dark:bg-gray-950">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Why this gateway</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl text-gray-900 dark:text-gray-100">
            Everything an integration needs, nothing it doesn't
          </h2>
          <p className="mt-4 text-gray-600 dark:text-gray-400">
            One endpoint, honest limits, and billing that works with local
            payment methods — built for shipping, not for a demo.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6 transition-colors hover:border-gray-400/50 dark:hover:border-gray-600"
            >
              <div className="flex size-10 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <feature.icon className="size-5 text-gray-900 dark:text-gray-100" aria-hidden />
              </div>
              <h3 className="mt-4 font-medium text-gray-900 dark:text-gray-100">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
