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
    version: 'v1.3.0',
    date: 'Oct 26, 2026',
    title: 'Halloween Edition — 30% Off Every Plan Until 1 November',
    description:
      'The whole product is wearing a costume for Halloween week. Landing page, navigation, pricing, docs, sign-in, dashboard and the D17 checkout now share one spooky look — and every plan is 30% off until 1 November 2026 at 00:00 Tunisia time. Starter is 35 DT instead of 50 DT; Pro is 63 DT instead of 90 DT, applied automatically when you pay.',
    details: [
      {
        heading: 'One discount, applied everywhere',
        body: 'The Halloween promotion is a single code module, not a catalog rewrite: 30% off the list price while the window is open. Landing pricing, /pricing, the dashboard billing page, the paywall cards and the D17 checkout all read the same discounted number, so no surface can advertise a price another one will not charge. Annual billing keeps its usual 20% saving on top.',
      },
      {
        heading: 'Base prices corrected to 50 DT and 90 DT',
        body: 'Starter now lists at 50 DT and Pro at 90 DT — the numbers every marketing page had been promising — instead of the 59 DT / 307 DT the old catalog converted to. The correction is a forward-only database migration that moves the catalog itself, so entitlements, overage and reporting keep their meaning. The sale is then applied on top: 35 DT and 63 DT until 1 November.',
      },
      {
        heading: 'Charged once, then locked',
        body: 'The discount is applied at the moment the D17 payment row is created, which is the only place money moves. The amount the customer is asked to transfer and the USD cents stored as paid are both the sale price, and approving the proof later never re-prices the sale — even if the window has closed by then.',
      },
      {
        heading: 'Whole-dinar transfers, in three languages',
        body: 'D17 transfers are collected in whole dinars: 50.000 / 90.000 TND normally, 35.000 / 63.000 TND during the sale. The checkout summary shows the saving with the crossed-out original, and the promotion line is translated for FR, AR and EN. The window closes automatically at 00:00 Tunisia time on 1 November; list prices and the rest of the product are unaffected.',
      },
    ],
  },
  {
    version: 'v1.2.0',
    date: 'Oct 22, 2026',
    title: 'Pro Refocus — 1,000 Smart + 500 Frontier',
    description:
      'Pro is now the power plan: 1,000 Sonnet 5.5 (Smart) prompts and 500 Opus 5.5 (Frontier) prompts per period. Fast (Haiku 5.5) stays Starter-only, so each tier has a clear job.',
    details: [
      {
        heading: 'What changed',
        body: 'Pro moves from {fast, smart, frontier} to {smart, frontier} with {smart: 1000, frontier: 500} prompt limits. Starter is unchanged at {fast, smart}. Existing Pro keys lose `fast` on the next entitlement sync; dashboards, docs, pricing, FAQ and the plan comparison table all show the new shape.',
      },
      {
        heading: 'Why',
        body: 'Fast is the high-volume Starter tier. Bundling it into Pro blurred the tiers and let Pro spend dilute across three models. Pro now concentrates its allowance where it matters: balanced everyday work (Smart) and the hardest reasoning (Frontier).',
      },
    ],
  },
  {
    version: 'v1.1.5',
    date: 'Oct 22, 2026',
    title: 'Standalone Desktop Beta — macOS, Windows & Linux',
    description:
      'The Zaino AI Agent ships as its own standalone desktop client for the first time: native installers for macOS (Apple Silicon + Intel), Windows (x64 + ARM64) and Linux (AppImage, .deb, .rpm on x86_64 + ARM64), with in-app auto-updates from our official GitHub releases. Download it directly from our server on the download page — no account needed.',
    details: [
      {
        heading: 'Standalone client, own releases',
        body: 'The desktop app is now built and published from its own repository (Louay0007/zaino-desktop) instead of riding upstream builds. Every installer bundles its matching sidecar CLI, so the engine and the window always agree. Installers are mirrored on our server under /downloads/v1.1.5 and stay available even if GitHub is slow.',
      },
      {
        heading: 'Every platform, both architectures',
        body: 'macOS ships Apple Silicon and Intel DMGs. Windows ships x64 and ARM64 installers with WebView2 embedded. Linux ships AppImage, .deb and .rpm for x86_64 and ARM64. System requirements on the download page now list both architectures per OS.',
      },
      {
        heading: 'In-app auto-updates',
        body: 'The Beta checks our GitHub release feed in the background and installs updates in place. You see the release notes the first time you open a new version — nothing to reinstall, ever.',
      },
      {
        heading: 'Sign in with Zaino',
        body: 'First launch opens your browser to approve the device — no key to copy. The key it receives lives in your OS keychain, never on disk. Only the models your plan allows appear in the picker: Fast and Smart on Starter, plus Frontier on Pro.',
      },
    ],
  },
  {
    version: 'v1.1.0',
    date: 'Oct 21, 2026',
    title: 'New Fleet — Fast (Haiku 5.5), Smart (Sonnet 5.5), Frontier (Opus 5.5)',
    description:
      'Zaino is back live on brand-new official infrastructure. The gateway now serves three models behind our three aliases: Fast rides Haiku 5.5, Smart rides Sonnet 5.5, and Frontier — back in the Pro plan — rides Opus 5.5. The dashboard, docs, and pricing now reflect the real models and rates.',
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
        body: 'The gateway fleet moved to Zaino official infrastructure. The price table, catalog, and billing pipeline were all moved to haiku-5.5 / sonnet-5.5 / opus-5.5 in one release, and the Pro plan allowlist plus prompt limits were restored to include frontier.',
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