'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import gsap from 'gsap';
import { ChevronDown } from 'lucide-react';
import { HalloweenDots } from "@/components/marketing/halloween-dots";

interface FaqItem {
  question: string;
  answer: string;
}

const faqItems: FaqItem[] = [
  {
    question: 'What is Zaino AI?',
    answer:
      'Zaino AI is a licensed cloud infrastructure provider with a direct commercial agreement with Anthropic. We provision dedicated Claude compute capacity for developers and teams in Tunisia and beyond, offering predictable pricing in local currency with D17 payment support.',
  },
  {
    question: 'How does usage-based billing work?',
    answer:
      'Each model tier (Fast, Smart, Frontier) has a blended-token budget per billing period. Blended tokens count every token that passes through the gateway — input, output, cache writes and cache reads — so long conversations consume proportionally more of the budget. Only successful inference calls are metered; failures and rate-limit rejections never consume quota.',
  },
  {
    question: 'What happens when I reach my monthly token budget?',
    answer:
      'Your service continues without interruption on models that still have budget left. Once a tier\'s blended-token budget is spent, additional inference calls on that tier return a clear "limit reached" error until you upgrade or the budget resets at the start of your next billing period.',
  },
  {
    question: 'Do you have an official agreement with Anthropic?',
    answer:
      'Yes. Zaino AI operates under a formal cloud provider agreement with Anthropic. We are not a reseller or proxy — we are a licensed infrastructure partner that provisions dedicated Claude API capacity. This means you get the same models, same safety standards, and same reliability as direct Anthropic customers, with localized billing and support.',
  },
  {
    question: 'Which models are available?',
    answer:
      'Availability depends on your plan. Starter includes Haiku 5.5 (Fast) and Sonnet 5.5 (Smart) with per-tier token budgets. Pro includes Sonnet 5.5 (Smart) and Opus 5.5 (Frontier) with larger budgets. Enterprise provides unlimited access to all current models plus early access to new model releases.',
  },
  {
    question: 'Can I switch plans or cancel anytime?',
    answer:
      'Absolutely. You can upgrade, downgrade, or cancel your subscription at any time from your dashboard. Upgrades take effect immediately with prorated billing. Downgrades and cancellations apply at the end of your current billing cycle. There are no lock-in contracts or hidden fees.',
  },
  {
    question: 'Is my data secure and private?',
    answer:
      'All gateway calls are processed through Anthropic\'s enterprise-grade infrastructure with end-to-end encryption. We do not store, log, or train on your prompts or responses. Our platform complies with international data protection standards, and our full privacy policy is publicly available.',
  },
  {
    question: 'Do you offer team or enterprise accounts?',
    answer:
      'Yes. Our Enterprise plan supports multi-seat team accounts with centralized billing, usage analytics, SSO integration, and a dedicated account manager. Contact our sales team for custom volume pricing and SLA agreements tailored to your organization\'s needs.',
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
      {/* Halloween ambient background */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-[#000000]" />
        <img src="/images/halloween/shape-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-soft-light opacity-30" />
        <div className="absolute top-1/4 right-[5%] w-72 h-72 rounded-full bg-purple-500/10 blur-[80px] animate-[pulse_9s_ease-in-out_infinite]" />
        <div className="absolute bottom-1/4 left-[8%] w-64 h-64 rounded-full bg-orange-500/10 blur-[80px] animate-[pulse_11s_ease-in-out_infinite_reverse]" />
        <HalloweenDots />
        {/* Ghost floating over the FAQ — it answers the spooky questions */}
        <img src="/images/halloween/category-ghost.png" alt="" aria-hidden="true" className="absolute top-6 right-6 sm:right-16 w-24 sm:w-32 md:w-40 h-auto opacity-90 pointer-events-none select-none animate-[pulse_6s_ease-in-out_infinite]" />
      </div>
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
              className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden transition-colors hover:border-orange-500/40"
            >
              {/* Question Button */}
              <button
                onClick={() => toggleItem(index)}
                className="w-full flex items-center justify-between px-6 py-5 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 rounded-xl"
                aria-expanded={openIndex === index}
                aria-controls={`faq-answer-${index}`}
              >
                <span className="text-base font-semibold text-white pr-4">
                  {item.question}
                </span>
                <span
                  ref={setChevronRef(index)}
                  className="shrink-0 text-orange-400"
                >
                  <ChevronDown className="h-5 w-5" />
                </span>
              </button>

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
              className="text-orange-400 font-medium hover:underline underline-offset-4"
            >
              Chat on WhatsApp
            </a>{' '}
            or call{' '}
            <a
              href="tel:+21656794578"
              className="text-orange-400 font-medium hover:underline underline-offset-4"
            >
              +216 56 794 578
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
