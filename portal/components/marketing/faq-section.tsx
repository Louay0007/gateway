'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import gsap from 'gsap';
import { ChevronDown } from 'lucide-react';

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
    question: 'How does request-based billing work?',
    answer:
      'We bill by requests (prompts), not tokens. Each time you send a prompt to a model — regardless of its length or the response size — it counts as one request against your plan quota. This makes costs fully predictable: a 50-word question and a 5,000-word analysis both consume exactly one request.',
  },
  {
    question: 'What happens when I reach my monthly request limit?',
    answer:
      'Your service continues without interruption. Once you hit your plan\'s request quota, additional requests are queued at standard priority rather than being blocked. You can upgrade your plan at any time to restore full-speed access immediately, or wait for your quota to reset at the start of your next billing cycle.',
  },
  {
    question: 'Do you have an official agreement with Anthropic?',
    answer:
      'Yes. Zaino AI operates under a formal cloud provider agreement with Anthropic. We are not a reseller or proxy — we are a licensed infrastructure partner that provisions dedicated Claude API capacity. This means you get the same models, same safety standards, and same reliability as direct Anthropic customers, with localized billing and support.',
  },
  {
    question: 'Which Claude models are available?',
    answer:
      'Availability depends on your plan. Starter includes Sonnet 5 and Opus 5.5. Pro adds higher request quotas. Enterprise provides unlimited access to all current models including Sonnet 5, Opus 5.5, Fable 5.1, and GPT-6 Astra, plus early access to new model releases.',
  },
  {
    question: 'Can I switch plans or cancel anytime?',
    answer:
      'Absolutely. You can upgrade, downgrade, or cancel your subscription at any time from your dashboard. Upgrades take effect immediately with prorated billing. Downgrades and cancellations apply at the end of your current billing cycle. There are no lock-in contracts or hidden fees.',
  },
  {
    question: 'Is my data secure and private?',
    answer:
      'All requests are processed through Anthropic\'s enterprise-grade infrastructure with end-to-end encryption. We do not store, log, or train on your prompts or responses. Our platform complies with international data protection standards, and our full privacy policy is publicly available.',
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
    <section ref={containerRef} className="w-full py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Heading */}
        <div data-faq-heading className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4 text-foreground">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about Zaino AI and how we work.
          </p>
        </div>

        {/* FAQ Items */}
        <div className="space-y-3">
          {faqItems.map((item, index) => (
            <div
              key={index}
              data-faq-item
              className="rounded-xl border border-border overflow-hidden transition-colors hover:border-primary/30"
              style={{ backgroundColor: 'var(--muted)' }}
            >
              {/* Question Button */}
              <button
                onClick={() => toggleItem(index)}
                className="w-full flex items-center justify-between px-6 py-5 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 rounded-xl"
                aria-expanded={openIndex === index}
                aria-controls={`faq-answer-${index}`}
              >
                <span className="text-base font-semibold text-foreground pr-4">
                  {item.question}
                </span>
                <span
                  ref={setChevronRef(index)}
                  className="shrink-0 text-muted-foreground"
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
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {item.answer}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer CTA */}
        <div className="text-center mt-10">
          <p className="text-sm text-muted-foreground">
            Still have questions?{' '}
            <a
              href="https://wa.me/21656794578"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium hover:underline underline-offset-4"
            >
              Chat on WhatsApp
            </a>{' '}
            or call{' '}
            <a
              href="tel:+21656794578"
              className="text-primary font-medium hover:underline underline-offset-4"
            >
              +216 56 794 578
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}