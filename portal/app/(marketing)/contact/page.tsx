import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Contact | Zaino AI",
  description:
    "Reach the person who runs Zaino — by email, WhatsApp or phone. No ticket queue, no chatbot.",
};

/**
 * /contact — the honest version of "contact sales".
 *
 * We do not have a sales team, so this page must not pretend to. It names
 * the three channels that actually reach a human and states the
 * expectation for each. A form that emails a black hole is the most common
 * way a small company wastes a warm lead's goodwill.
 *
 * No form on purpose: there is no ticketing system behind one, and a
 * `<form>` that silently drops a message is worse than a mailto.
 */
const CHANNELS = [
  {
    icon: Mail,
    label: "Email",
    value: "contact.zaino.ai@gmail.com",
    href: "mailto:contact.zaino.ai@gmail.com",
    note: "Best for billing questions, invoices and anything with an attachment. Usually answered the same day.",
  },
  {
    icon: MessageCircle,
    label: "WhatsApp",
    value: "+216 56 794 578",
    href: "https://wa.me/21656794578",
    note: "Fastest for a quick technical question. Mon–Sat, Tunis time.",
  },
  {
    icon: Phone,
    label: "Phone",
    value: "+216 56 794 578",
    href: "tel:+21656794578",
    note: "Use it if a payment is stuck. A human answers, not a menu.",
  },
] as const;

export default function ContactPage() {
  return (
    <>
      <SiteNav active="Contact" />
      <main className="pt-16">
        <section className="bg-white py-16 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 lg:px-8">
            <p className="text-sm font-medium text-muted-foreground">
              Contact
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Talk to the person who runs it
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Zaino is small on purpose. There is no sales team, no ticket
              queue and no chatbot in front of this address — a message here
              reaches someone who can change the product.
            </p>

            <ul className="mt-12 grid gap-4">
              {CHANNELS.map(({ icon: Icon, label, value, href, note }) => (
                <li
                  key={label}
                  className="flex flex-col gap-3 rounded-2xl border border-border p-6 sm:flex-row sm:items-start sm:gap-5"
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="size-4 text-foreground" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                      {label}
                    </p>
                    <a
                      href={href}
                      className="mt-1 block font-mono text-base break-all font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {value}
                    </a>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {note}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-12 rounded-2xl border border-border p-6">
              <p className="text-sm font-medium text-foreground">
                Before you write: two answers that save a round trip
              </p>
              <ul className="mt-3 grid gap-2 text-sm leading-relaxed text-muted-foreground">
                <li>
                  <strong className="font-medium text-foreground">
                    Payment is D17 or card.
                  </strong>{" "}
                  Dinar transfers settle by hand, usually within hours. Card
                  checkout is instant.
                </li>
                <li>
                  <strong className="font-medium text-foreground">
                    Keys and usage.
                  </strong>{" "}
                  If your key stopped working, check the{" "}
                  <Link href="/dashboard/usage" className="underline underline-offset-4">
                    usage page
                  </Link>{" "}
                  first — a spent token pool pauses every model on the plan.
                </li>
              </ul>
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              <Button size="lg" nativeButton={false} render={<Link href="/pricing" />}>
                See plans
              </Button>
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href="/connect" />}
              >
                Connect a tool
              </Button>
            </div>
          </div>
        </section>
      </main>
      <ZainoFooter />
    </>
  );
}
