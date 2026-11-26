'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import gsap from 'gsap';
import { ChevronDown } from 'lucide-react';
import { Ambient } from "@/components/marketing/ambient";
import { Button } from "@/components/ui/button";

interface FaqItem {
  question: string;
  answer: string;
}

const faqItems: FaqItem[] = [
  {
    question: 'What is Zaino AI?',
    answer:
      'Zaino AI is an LLM gateway for developers and teams in Tunisia and beyond. It gives you one API key and one shared token pool per plan, speaking the OpenAI and Anthropic wire formats natively so your existing tools work unchanged. Pricing is predictable, in local currency, with D17 payment support.',
  },
  {
    question: 'How does usage-based billing work?',
    answer:
      'Each plan includes one pool of blended tokens per month, spendable on any model the plan covers — there is no per-model cap. A blended token is not a raw token: a cached re-read costs a tenth of one, an output token costs five, and the tier you use scales it (smart is the unit, frontier five times it). So a long conversation costs far less than its raw prompt size suggests, and a frontier call costs more than a smart one. Only successful inference calls are metered; failures never consume quota. Per-minute request limits apply and are listed on each plan.'
  },
  {
    question: 'What happens when I reach my monthly token budget?',
    answer:
      'Your allowance is one shared pool with no per-model limit: a heavy month on one model still leaves the rest spendable on another. When the pool is spent, every model on the plan returns a clear "out of tokens for this period" error until the plan renews — or you upgrade for more allowance immediately.',
  },
  {
    question: 'Who provides the models behind Zaino?',
    answer:
      "Zaino is an independent gateway built on Anthropic- and OpenAI-compatible wire formats. Compatibility means your existing SDKs and tools work unchanged against us — it does not imply any partnership with, endorsement by, or affiliation with those vendors, and we do not claim one. What we are responsible for is the layer you actually touch: the key, the quota, the meter and the billing.",
  },

  {
    question: 'Which models are available?',
    answer:
      'Availability depends on your plan. Starter covers fast and smart. Pro adds frontier and fable, plus more API keys. Every model you are entitled to is served at full capability — no throttled variant, no smaller context window.',
  },
  {
    question: 'Can I switch plans or cancel anytime?',
    answer:
      'Absolutely. You can upgrade, downgrade, or cancel your subscription at any time from your dashboard. Upgrades take effect immediately with prorated billing. Downgrades and cancellations apply at the end of your current billing cycle. There are no lock-in contracts or hidden fees.',
  },
  {
    question: 'Is my data secure and private?',
    answer:
      'Every request is TLS-encrypted end to end, and we do not log prompt or response bodies: LiteLLM is configured with store_prompts_in_spend_logs off, so the spend ledger records token counts and cost, never content. We do not train on your data. The full policy is at /privacy.',
  },
  {
    question: 'Can I sign in with Google or GitHub instead of a password?',
    answer:
      'Yes, when those providers are enabled on this deployment. Signing in with a provider you already use skips the password entirely, and if the address it returns has been verified by that provider it is matched to your existing account rather than creating a second one. Nothing is linked on an unverified address, and a provider email that differs from your account email never replaces it. You can keep using a password at any time — the two methods work side by side and neither is ever required.',
  },
  {
    question: 'Why was I asked to confirm my email after signing in with a provider?',
    answer:
      'Because not every provider verifies the address it hands us. GitHub, for example, does not verify addresses it does not own. When the address was not verified by the provider, we create the account but require our own confirmation link before it can create keys, start a checkout, use chat, or redeem a trial. That is deliberate: those actions either cost real money or spend real tokens, and we will not spend them on an address nobody has proven they can receive mail at.',
  },
];

export default function FaqSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const chevronRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const setContentRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    contentRefs.current[index] = el;
  }, []);

  const setChevronRef = useCallback((index: number) => (el: HTMLSpanElement | null) => {
    chevronRefs.current[index] = el;
  }, []);

  // Entrance animation
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ctx = gsap.context(() => {
      const heading = el.querySelector('[data-faq-heading]');
      const items = el.querySelectorAll('[data-faq-item]');
      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
      if (heading) {
        tl.from(heading, { opacity: 0, y: 20, duration: 0.6 }, 0);
      }
      if (items.length > 0) {
        tl.from(items, { opacity: 0, y: 16, duration: 0.4, stagger: 0.06 }, 0.15);
      }
    }, el);
    return () => ctx.revert();
  }, []);

  // Smooth open/close animation
  useEffect(() => {
    faqItems.forEach((_, index) => {
      const content = contentRefs.current[index];
      const chevron = chevronRefs.current[index];
      if (!content || !chevron) return;

      const isOpen = openIndex === index;

      // Use transform-based animation for GPU compositing (no layout thrashing)
      if (isOpen) {
        content.style.willChange = 'height, opacity';
        chevron.style.willChange = 'transform';
      }

      gsap.to(content, {
        height: isOpen ? content.scrollHeight : 0,
        opacity: isOpen ? 1 : 0,
        duration: 0.35,
        ease: 'power2.inOut',
        overwrite: true,
        onComplete: () => {
          if (!isOpen) {
            content.style.willChange = 'auto';
          }
        },
      });

      gsap.to(chevron, {
        rotation: isOpen ? 180 : 0,
        duration: 0.3,
        ease: 'power2.inOut',
        overwrite: true,
        onComplete: () => {
          if (!isOpen) {
            chevron.style.willChange = 'auto';
          }
        },
      });
    });
  }, [openIndex]);

  const toggleItem = useCallback((index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  }, []);

  return (
    <section ref={containerRef} className="relative w-full py-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
      <Ambient />
      <div className="max-w-3xl mx-auto">
        {/* Heading */}
        <div data-faq-heading className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4 text-mkt-ink">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-mkt-muted">
            Everything you need to know about Zaino AI and how we work.
          </p>
        </div>

        {/* FAQ Items */}
        <div className="space-y-3">
          {faqItems.map((item, index) => (
            <div
              key={index}
              data-faq-item
              className="rounded-xl border border-mkt-line bg-mkt-surface overflow-hidden transition-colors hover:border-mkt-accent/40"
            >
              {/* Question Button */}
              <Button
                type="button"
                variant="ghost"
                id={`faq-question-${index}`}
                onClick={() => toggleItem(index)}
                className="w-full justify-between rounded-xl px-6 py-5 text-left hover:bg-transparent"
                aria-expanded={openIndex === index}
                aria-controls={`faq-answer-${index}`}
              >
                <span className="text-base font-semibold text-mkt-ink pr-4">
                  {item.question}
                </span>
                <span
                  ref={setChevronRef(index)}
                  className="shrink-0 text-mkt-accent"
                >
                  <ChevronDown className="h-5 w-5" />
                </span>
              </Button>

              {/* Answer — animated height + opacity */}
              <div
                id={`faq-answer-${index}`}
                ref={setContentRef(index)}
                className="overflow-hidden"
                style={{ height: 0, opacity: 0 }}
                role="region"
                aria-labelledby={`faq-question-${index}`}
              >
                <div className="px-6 pb-5 pt-0">
                  <p className="text-sm leading-relaxed text-mkt-muted">
                    {item.answer}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer CTA */}
        <div className="text-center mt-10">
          <p className="text-sm text-mkt-muted">
            Still have questions?{' '}
            <a
              href="https://wa.me/21656794578"
              target="_blank"
              rel="noopener noreferrer"
              className="text-mkt-accent font-medium hover:underline underline-offset-4"
            >
              Chat on WhatsApp
            </a>{' '}
            or call{' '}
            <a
              href="tel:+21656794578"
              className="text-mkt-accent font-medium hover:underline underline-offset-4"
            >
              +216 56 794 578
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
