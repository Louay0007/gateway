import type { Metadata } from "next";

import Navbar from "@/components/shadcn-space/blocks/hero-33/navbar";
import { MarketingFooter } from "@/components/marketing/footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Zaino AI collects, uses, and protects your data when you use our API gateway and portal.",
};

export default function PrivacyPage() {
  return (
    <>
      <div className="light-surface">
        <Navbar />
      </div>
      <main className="bg-white dark:bg-black py-16 sm:py-24">
        <article className="mx-auto max-w-3xl px-4 lg:px-8">
          <h1 className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Last updated: October 17, 2026</p>

          <div className="prose prose-gray mt-10 max-w-none text-gray-600 dark:text-gray-400">
            <Section title="1. What we collect">
              <p>
                We collect the minimum data needed to operate an API gateway: your email address
                and password hash for authentication, organisation name for billing, API key
                metadata (alias, model access, budget ceiling), and request-level usage records
                (model, token counts, cost) so spend ceilings can be enforced in real time.
              </p>
              <p className="mt-3">
                We do not store the prompts or completions that pass through the gateway. Request
                bodies are forwarded to the upstream provider and discarded; only the metadata
                above is retained.
              </p>
            </Section>

            <Section title="2. How we use it">
              <ul className="list-disc space-y-2 pl-5">
                <li>Authenticate you and scope keys to your organisation.</li>
                <li>Enforce spend ceilings at the gateway before requests reach the upstream.</li>
                <li>Generate usage reports and invoices for D17 and card payments.</li>
                <li>Send transactional email (verification, password reset, payment receipt).</li>
              </ul>
            </Section>

            <Section title="3. Where it lives">
              <p>
                All data is stored in a self-hosted PostgreSQL database on our VPS. We do not use
                third-party analytics, tracking pixels, or advertising networks. Resend delivers
                transactional email under their own privacy policy; no marketing email is sent
                without explicit consent.
              </p>
            </Section>

            <Section title="4. Sharing and disclosure">
              <p>
                We share data only when required to deliver the service: upstream providers
                receive the API requests you make (under their own policies), and Resend receives
                the transactional emails we send on your behalf. We do not sell, rent, or share
                personal data for advertising or profiling. Disclosure to authorities occurs only
                when required by law and with notice where legally permitted.
              </p>
            </Section>

            <Section title="5. Retention">
              <p>
                Account data is retained while the account is active. Usage records are kept for
                90 days for billing reconciliation and then aggregated; individual request logs
                are deleted after 30 days. On account deletion, all personal data is removed
                within 30 days except where retention is required by law or for unresolved
                billing disputes.
              </p>
            </Section>

            <Section title="6. Your rights">
              <p>
                You may request a copy of your data, correction of inaccuracies, or deletion of
                your account at any time by emailing{" "}
                <a href="mailto:privacy@zaino.ai" className="text-gray-900 dark:text-gray-100 underline-offset-4 hover:underline">
                  privacy@zaino.ai
                </a>
                . We respond within 30 days. Tunisian users have the same rights under local data
                protection law.
              </p>
            </Section>

            <Section title="7. Security">
              <p>
                Passwords are hashed with bcrypt. API keys are stored as salted hashes; the raw
                key is shown only once at creation. All traffic is encrypted in transit via TLS.
                The VPS is hardened per CIS benchmarks and patched weekly. Breach notification
                follows applicable law.
              </p>
            </Section>

            <Section title="8. Changes">
              <p>
                Material changes to this policy will be announced via email or a banner on the
                portal. Continued use after the effective date constitutes acceptance.
              </p>
            </Section>

            <Section title="9. Contact">
              <p>
                Questions about this policy:{" "}
                <a href="mailto:privacy@zaino.ai" className="text-gray-900 dark:text-gray-100 underline-offset-4 hover:underline">
                  privacy@zaino.ai
                </a>
                . For general support, use the dashboard or email{" "}
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
      <div className="mt-2 [&>p]:leading-relaxed">{children}</div>
    </section>
  );
}