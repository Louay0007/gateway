import type { Metadata } from "next";

import Navbar from "@/components/shadcn-space/blocks/hero-33/navbar";
import { MarketingFooter } from "@/components/marketing/footer";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The agreement between you and Zaino AI covering API access, spend ceilings, acceptable use, and D17 payments.",
};

export default function TermsPage() {
  return (
    <>
      <div className="light-surface">
        <Navbar tone="light" />
      </div>
      <main className="bg-white dark:bg-gray-950 py-16 sm:py-24">
        <article className="mx-auto max-w-3xl px-4 lg:px-8">
          <h1 className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
            Terms of Service
          </h1>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Last updated: October 17, 2026</p>

          <div className="prose prose-gray mt-10 max-w-none text-gray-600 dark:text-gray-400">
            <Section title="1. The service">
              <p>
                Zaino AI provides an OpenAI- and Anthropic-compatible API gateway that routes
                requests to upstream model providers, enforces per-key spend ceilings, and bills
                usage monthly. The gateway is not a model provider; upstream availability,
                latency, and output quality depend on third parties.
              </p>
            </Section>

            <Section title="2. Accounts and keys">
              <p>
                You must provide accurate information when creating an account. Each API key is
                scoped to your organisation and subject to the budget ceiling set at creation.
                Keys are non-transferable. You are responsible for all usage under your keys,
                including usage by anyone who obtains them through your negligence.
              </p>
            </Section>

            <Section title="3. Spend ceilings and billing">
              <p>
                Every plan has a prompt quota per model tier enforced at the gateway. When the quota is
                reached, further inference calls return 403 until the next billing period or until you
                upgrade. Usage is billed monthly in US dollars; Tunisian accounts may
                pay via D17 transfer at La Poste at the published rate. Usage is non-refundable
                once consumed.
              </p>
            </Section>

            <Section title="4. Acceptable use">
              <p>You may not use the service to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Violate any applicable law or regulation.</li>
                <li>Generate content that is illegal, abusive, or deceptive.</li>
                <li>Resell or sublicense API access without written agreement.</li>
                <li>Reverse-engineer the gateway or attempt to bypass spend ceilings.</li>
                <li>Interfere with the service's operation or other users' access.</li>
              </ul>
              <p className="mt-3">
                Violations result in immediate suspension without refund. We reserve the right to
                refuse service to anyone for any reason.
              </p>
            </Section>

            <Section title="5. Upstream dependencies">
              <p>
                The gateway depends on upstream model providers. Outages, rate limits, pricing
                changes, or policy changes at those providers may affect availability and cost.
                We pass through upstream pricing changes with notice where possible but are not
                liable for upstream failures.
              </p>
            </Section>

            <Section title="6. Intellectual property">
              <p>
                You retain ownership of the prompts you send and the outputs you receive, subject
                to the upstream provider's terms. Zaino AI retains ownership of the gateway
                software, branding, and documentation. No licence is granted beyond what is
                necessary to use the service.
              </p>
            </Section>

            <Section title="7. Disclaimers">
              <p>
                The service is provided "as is" without warranty of any kind. We do not warrant
                that the service will be uninterrupted, error-free, or that outputs will be
                accurate or suitable for any purpose. Model outputs may be inaccurate, biased, or
                harmful; you are responsible for verifying and using them appropriately.
              </p>
            </Section>

            <Section title="8. Limitation of liability">
              <p>
                To the maximum extent permitted by law, Zaino AI's total liability is limited to
                the amount you paid in the 12 months preceding the claim. We are not liable for
                indirect, incidental, consequential, or punitive damages, including lost profits
                or data loss.
              </p>
            </Section>

            <Section title="9. Termination">
              <p>
                Either party may terminate at any time. On termination, outstanding balances
                remain due, unused credits are forfeited, and API keys are revoked immediately.
                Sections 4, 6–10 survive termination.
              </p>
            </Section>

            <Section title="10. Governing law">
              <p>
                These terms are governed by Tunisian law. Disputes are resolved in the courts of
                Tunis. Where Tunisian law does not apply, the governing law is that of the
                jurisdiction where Zaino AI is incorporated.
              </p>
            </Section>

            <Section title="11. Changes">
              <p>
                We may update these terms with notice via email or a portal banner. Continued use
                after the effective date constitutes acceptance. Material adverse changes take
                effect 30 days after notice.
              </p>
            </Section>

            <Section title="12. Contact">
              <p>
                Legal inquiries:{" "}
                <a href="mailto:legal@zaino.ai" className="text-gray-900 dark:text-gray-100 underline-offset-4 hover:underline">
                  legal@zaino.ai
                </a>
                . Support:{" "}
                <a href="mailto:contact.zaino.ai@gmail.com" className="text-gray-900 dark:text-gray-100 underline-offset-4 hover:underline">
                  contact.zaino.ai@gmail.com
                </a>
                .
              </p>
            </Section>
          </div>
        </article>
      </main>
      <MarketingFooter />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="mt-2 [&>p]:leading-relaxed [&>ul]:mt-2">{children}</div>
    </section>
  );
}