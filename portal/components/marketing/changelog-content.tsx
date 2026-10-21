'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface DetailBlock {
  heading: string;
  body: string;
}

interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  description: string;
  details: DetailBlock[];
}

const entries: ChangelogEntry[] = [
  {
    version: 'v1.1.0',
    date: 'Oct 21, 2026',
    title: 'AiPilot Fleet — Fast (Haiku 5.5), Smart (Sonnet 5.5), Frontier (Opus 5.5)',
    description:
      'Zaino is back live on a brand-new upstream. The gateway now serves three AiPilot models behind our three aliases: Fast rides Haiku 5.5, Smart rides Sonnet 5.5, and Frontier — back in the Pro plan — rides Opus 5.5. The dashboard, docs, and pricing now reflect the real models and rates.',
    details: [
      {
        heading: 'Fast — Haiku 5.5',
        body: 'High-volume work at $1.00 / $5.00 per Mtok: drafts, classification, bulk transforms, chat and copilots. Available on Starter and Pro. Request it with "model": "fast".',
      },
      {
        heading: 'Smart — Sonnet 5.5',
        body: 'Everyday balanced tier at $3.00 / $15.00 per Mtok: agents, tool calling, support bots. Available on Starter and Pro. Request it with "model": "smart".',
      },
      {
        heading: 'Frontier returns — Opus 5.5',
        body: 'Mythos-class reasoning at $15.00 / $75.00 per Mtok for the hardest long-running workloads: deep reasoning, multi-step agents, hard tasks. Pro only, with 250 prompts per period. Request it with "model": "frontier". Frontier was held back during the migration and is now fully metered and billed.',
      },
      {
        heading: 'Token pricing, corrected everywhere',
        body: 'Every surface that still showed the old model names or rates has been updated in one pass: the customer docs (/docs models), the pricing preview, the dashboard billing table, the prompt meters, the download page, the FAQ, and the redeem page. No upstream name ever reaches the customer surface — only fast, smart, frontier.',
      },
      {
        heading: 'What changed under the hood',
        body: 'The gateway upstream switched to AiPilot (aipilot-weld.vercel.app/v1). The price table, LiteLLM catalog, reconcile script, and pricing-consistency suite were all moved to haiku-5.5 / sonnet-5.5 / opus-5.5 in one commit, and the Pro plan allowlist plus prompt limits were restored to include frontier.',
      },
    ],
  },
  {
    version: 'v1.0.1',
    date: 'Oct 17, 2026',
    title: 'Official Launch — Codex & Claude Code Integrations, Desktop App',
    description:
      'Zaino AI v1.0.1 marks our official public launch. Connect your existing AI coding workflows through native integrations with OpenAI Codex and Anthropic Claude Code, and manage everything from our new cross-platform desktop application.',
    details: [
      {
        heading: 'Codex Integration',
        body: "Connect OpenAI Codex directly to Zaino AI using our OpenAI-compatible API endpoint. Drop in your Zaino API key as a replacement for your OpenAI key — no code changes required. All Codex requests route through Zaino's licensed infrastructure with automatic spend tracking and per-request billing.",
      },
      {
        heading: 'Claude Code Integration',
        body: "Use Anthropic Claude Code with Zaino AI through our Anthropic-compatible API. Configure your ANTHROPIC_BASE_URL to point to Zaino's endpoint and authenticate with your Zaino API key. Full tool-use, extended thinking, and multi-turn conversation support included.",
      },
      {
        heading: 'Desktop Application',
        body: 'Our new cross-platform desktop app gives you a unified view of all your integrations, real-time usage analytics, API key management, and billing controls — all from a single window. Built with Electron for macOS, Windows, and Linux with native system tray integration and auto-updates.',
      },
      {
        heading: 'Unified Dashboard',
        body: 'Monitor all your AI coding tool usage from one place. Track requests, tokens, and costs across Codex, Claude Code, and any other compatible client. Set per-integration spend limits, view historical usage trends, and export billing reports.',
      },
      {
        heading: 'Request-Based Billing',
        body: 'Pay only for what you use with transparent per-request pricing. Set hard spend ceilings that automatically pause integrations when reached — no surprise bills. Real-time cost visibility in both the web dashboard and desktop app.',
      },
      {
        heading: 'D17 Payment for Tunisia',
        body: 'First-class support for Tunisian D17 mobile payments. Top up your Zaino balance directly from your phone without needing an international credit card. Instant balance updates with SMS confirmation.',
      },
    ],
  },
];

export default function ChangelogContent() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      gsap.ticker.fps(120);

      // Page header animation
      const pageHeader = containerRef.current!.querySelector('.page-header');
      if (pageHeader) {
        const headerWords = pageHeader.querySelectorAll('.word');
        gsap.fromTo(
          pageHeader,
          { filter: 'blur(14px)' },
          { filter: 'blur(0px)', duration: 1.2, ease: 'power3.out' }
        );
        gsap.fromTo(
          headerWords,
          { y: 70, opacity: 0, rotateX: -50 },
          {
            y: 0,
            opacity: 1,
            rotateX: 0,
            stagger: 0.09,
            duration: 1,
            ease: 'power3.out',
            delay: 0.2,
          }
        );
      }

      // Subtitle fade
      const subtitle = containerRef.current!.querySelector('.page-subtitle');
      if (subtitle) {
        gsap.fromTo(
          subtitle,
          { opacity: 0, y: 30 },
          { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out', delay: 1.1 }
        );
      }

      // Animate each entry with ScrollTrigger
      const sections = containerRef.current!.querySelectorAll('.changelog-entry');
      sections.forEach((section) => {
        const versionBadge = section.querySelector('.version-badge');
        const title = section.querySelector('.entry-title');
        const description = section.querySelector('.entry-description');
        const detailBlocks = section.querySelectorAll('.detail-block');

        // Version badge
        if (versionBadge) {
          gsap.fromTo(
            versionBadge,
            { opacity: 0, scale: 0.85 },
            {
              opacity: 1,
              scale: 1,
              duration: 0.6,
              ease: 'back.out(1.7)',
              scrollTrigger: {
                trigger: versionBadge,
                start: 'top 85%',
              },
            }
          );
        }

        // Title word reveal
        if (title) {
          const words = title.querySelectorAll('.word');
          gsap.fromTo(
            title,
            { filter: 'blur(12px)' },
            {
              filter: 'blur(0px)',
              duration: 1,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: title,
                start: 'top 80%',
              },
            }
          );
          gsap.fromTo(
            words,
            { y: 60, opacity: 0, rotateX: -40 },
            {
              y: 0,
              opacity: 1,
              rotateX: 0,
              stagger: 0.05,
              duration: 0.9,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: title,
                start: 'top 80%',
              },
            }
          );
        }

        // Description
        if (description) {
          gsap.fromTo(
            description,
            { opacity: 0, y: 40 },
            {
              opacity: 1,
              y: 0,
              duration: 0.8,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: description,
                start: 'top 85%',
              },
            }
          );
        }

        // Detail blocks cascade with ScrollTrigger
        detailBlocks.forEach((block) => {
          const heading = block.querySelector('.detail-heading');
          const body = block.querySelector('.detail-body');

          gsap.fromTo(
            block,
            { opacity: 0, y: 60 },
            {
              opacity: 1,
              y: 0,
              duration: 0.8,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: block,
                start: 'top 85%',
              },
            }
          );

          if (heading) {
            gsap.fromTo(
              heading,
              { opacity: 0, x: -25 },
              {
                opacity: 1,
                x: 0,
                duration: 0.6,
                ease: 'power2.out',
                scrollTrigger: {
                  trigger: block,
                  start: 'top 82%',
                },
              }
            );
          }

          if (body) {
            gsap.fromTo(
              body,
              { opacity: 0, y: 20 },
              {
                opacity: 1,
                y: 0,
                duration: 0.7,
                ease: 'power2.out',
                scrollTrigger: {
                  trigger: block,
                  start: 'top 80%',
                },
              }
            );
          }

          
        });
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  const splitWords = (text: string) =>
    text.split(' ').map((word, i, arr) => (
      <span
        key={i}
        className="word inline-block"
        style={{ willChange: 'transform, opacity' }}
      >
        {word}
        {i < arr.length - 1 ? '\u00A0' : ''}
      </span>
    ));

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-3xl px-6 pt-32 pb-24">
      {/* Page Header */}
      <div className="page-header mb-6">
        <h1
          className="text-5xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-6xl"
          style={{ perspective: '800px' }}
        >
          {splitWords('Changelog')}
        </h1>
      </div>
      <p className="page-subtitle mb-20 text-lg leading-relaxed text-gray-500 dark:text-gray-400">
        Product updates, new features, and improvements across Zaino AI integrations and the desktop app.
      </p>

      {/* Entries */}
      {entries.map((entry) => (
        <article key={entry.version} className="changelog-entry">
          {/* Version + Date */}
          <div className="version-badge mb-8 flex items-center gap-4">
            <span className="inline-flex items-center rounded-full bg-gray-900 dark:bg-gray-700 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white">
              {entry.version}
            </span>
            <time className="text-sm font-medium text-gray-500 dark:text-gray-400">{entry.date}</time>
          </div>

          {/* Title */}
          <h2
            className="entry-title mb-6 text-3xl font-bold leading-tight text-gray-900 dark:text-gray-100 sm:text-4xl"
            style={{ perspective: '800px' }}
          >
            {splitWords(entry.title)}
          </h2>

          {/* Description */}
          <p className="entry-description mb-14 text-lg leading-relaxed text-gray-600 dark:text-gray-400">
            {entry.description}
          </p>

          {/* Detail Sections */}
          <div className="space-y-20">
            {entry.details.map((detail, i) => (
              <div key={i} className="detail-block">
                <h3 className="detail-heading mb-3 text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {detail.heading}
                </h3>
                <p className="detail-body mb-6 text-base leading-relaxed text-gray-600 dark:text-gray-400">
                  {detail.body}
                </p>
              </div>
            ))}
          </div>

          {/* Divider */}
          <hr className="mt-20 border-gray-200 dark:border-gray-800" />
        </article>
      ))}
    </div>
  );
}