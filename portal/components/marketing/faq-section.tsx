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
      'Each plan includes one pool of 50M blended tokens per month. Spend it on whichever of the plan\'s models you like — 30M on one and 20M on another, 10M and 40M, or all 50M on a single model. There is no per-model cap. Blended tokens count every token that passes through the gateway — input, output, cache writes and cache reads — so long conversations consume proportionally more of the budget. Only successful inference calls are metered; failures never consume quota. There are no per-minute rate limits and no dollar caps on top — the monthly token pool is the only limit.',
  },
  {
    question: 'What happens when I reach my monthly token budget?',
    answer:
      'Your allowance is one shared pool, so it has no per-model limit: a heavy month on one model still leaves the rest spendable on another. When the whole pool is spent, every model on the plan returns a clear "out of tokens for this period" error until your plan renews — or you upgrade for more allowance immediately.',
  },
  {
    question: 'Who provides the models behind Zaino?',
    answer:
      "Zaino is an independent gateway built on Anthropic- and OpenAI-compatible wire formats. Compatibility means your existing SDKs and tools work unchanged against us — it does not imply any partnership with, endorsement by, or affiliation with those vendors, and we do not claim one. What we are responsible for is the layer you actually touch: the key, the quota, the meter and the billing.",
  },

  {
    question: 'Which models are available?',
    answer:
      'Availability depends on your plan. Starter includes fast and smart, sharing one 50M pool. Pro includes smart, frontier and fable, also 50M — the difference is which models you can call and how many keys and seats you get, not the size of the pool. Both plans include every model you are entitled to at full capability.',
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
    question: 'Can I sign in with Google, GitHub, or Apple instead of a password?',
    answer:
      'Yes, when those providers are enabled on this deployment. Signing in with a provider you already use skips the password entirely, and if the address it returns has been verified by that provider it is matched to your existing account rather than creating a second one. Nothing is linked on an unverified address, and a provider email that differs from your account email never replaces it. You can keep using a password at any time — the two methods work side by side and neither is ever required.',
  },
  {
    question: 'Why was I asked to confirm my email after signing in with a provider?',
    answer:
      'Because not every provider verifies the address it hands us. GitHub, for example, does not verify addresses it does not own, and Apple can return a private relay address. When the address was not verified by the provider, we create the account but require our own confirmation link before it can create keys, start a checkout, use chat, or redeem a trial. That is deliberate: those actions either cost real money or spend real tokens, and we will not spend them on an address nobody has proven they can receive mail at.',
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
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4 text-white">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-white/60">
            Everything you need to know about Zaino AI and how we work.
          </p>
        </div>

        {/* FAQ Items */}
        <div className="space-y-3">
          {faqItems.map((item, index) => (
            <div
              key={index}
              data-faq-item
              className="rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden transition-colors hover:border-[#A558FB]/40"
            >
              {/* Question Button */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => toggleItem(index)}
                className="w-full justify-between rounded-xl px-6 py-5 text-left"
                aria-expanded={openIndex === index}
                aria-controls={`faq-answer-${index}`}
              >
                <span className="text-base font-semibold text-white pr-4">
                  {item.question}
                </span>
                <span
                  ref={setChevronRef(index)}
                  className="shrink-0 text-[#A558FB]"
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
                  <p className="text-sm leading-relaxed text-white/60">
                    {item.answer}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer CTA */}
        <div className="text-center mt-10">
          <p className="text-sm text-white/60">
            Still have questions?{' '}
            <a
              href="https://wa.me/21656794578"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#A558FB] font-medium hover:underline underline-offset-4"
            >
              Chat on WhatsApp
            </a>{' '}
            or call{' '}
            <a
              href="tel:+21656794578"
              className="text-[#A558FB] font-medium hover:underline underline-offset-4"
            >
              +216 56 794 578
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
