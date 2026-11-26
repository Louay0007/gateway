import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Download, ShieldCheck } from 'lucide-react';

import SiteNav from '@/components/marketing/site-nav';
import ZainoFooter from '@/components/marketing/zaino-footer';
import { CodeBlock } from '@/components/docs/code-block';

export const metadata: Metadata = {
  title: 'Download the Zaino AI extension for VS Code',
  description:
    'The official Zaino AI extension for VS Code is available. Install it, sign in with your Zaino account, and start coding.',
};

/**
 * /download — the official VS Code extension.
 *
 * This page used to be a "not yet" page for a CLI, with Claude Desktop
 * instructions and curl diagnostics standing in for a shipped product. The
 * extension is now the product: one file, one install command, one sign-in.
 *
 * The layout is deliberately short. A visitor arriving here wants three
 * answers — is it ready, how do I install it, what happens next — and the
 * page gives them in that order, with the download above the fold.
 */

/** Served by Caddy (`handle_path /downloads/*`) from data/downloads. */
const EXTENSION_FILE = '/downloads/zaino-1.0.1.vsix';
const EXTENSION_VERSION = '1.0.1';
const VS_CODE_VERSION = '1.101 or newer';

/** The same directory /api/downloads lists, so both agree on what shipped. */
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || '/app/data/downloads';

/**
 * The size printed beside the button, read from the artifact itself.
 *
 * Hardcoding "14 MB" was wrong within one build: the file is 14.6 MB, and a
 * hand-typed size drifts on every release. `stat` is the one source of truth
 * — the same bytes Caddy serves. Decimal units (1 MB = 1,000,000) because
 * that is what the visitor's file manager shows for the download they just
 * saved; binary MiB would print 13.9 MB for the same file and read as a
 * different one. When the file is absent (a dev checkout with no
 * DOWNLOADS_DIR) the size is simply not claimed, rather than printing a
 * number nobody verified.
 */
async function extensionSize(): Promise<string | null> {
  try {
    const { size } = await stat(join(DOWNLOADS_DIR, 'zaino-1.0.1.vsix'));
    return `${(size / 1_000_000).toFixed(1)} MB`;
  } catch {
    return null;
  }
}

const INSTALL_STEPS = [
  {
    title: 'Download the extension',
    body: 'A single .vsix file. No account is needed to download it.',
  },
  {
    title: 'Install it in VS Code',
    body: 'Open the Extensions view, choose “Install from VSIX…”, and pick the file you downloaded.',
  },
  {
    title: 'Sign in and start coding',
    body: 'Click “Sign in with Zaino AI”. Your browser opens the approval page, you confirm the code, and a key is created for you — no key to copy.',
  },
] as const;

const REQUIREMENTS = [
  { label: 'Editor', value: `VS Code ${VS_CODE_VERSION}` },
  { label: 'Platforms', value: 'macOS, Windows, Linux' },
  { label: 'Network', value: 'api.zaino.soon.it' },
  { label: 'Account', value: 'Any active Zaino plan (or the 3-day trial)' },
] as const;

const INSTALL_COMMAND = `code --install-extension ~/Downloads/zaino-1.0.1.vsix`;

const verifyCommand = `code --list-extensions | grep zaino`;

export default async function DownloadPage() {
  const size = await extensionSize();

  return (
    <div className="flex min-h-screen flex-col bg-mkt-bg text-mkt-ink">
      <SiteNav active="Download" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16 sm:py-20">
        {/* ── Header: the announcement, with the download in reach ─────── */}
        <header className="max-w-[62ch]">
          <span className="inline-flex items-center gap-2 rounded-full border border-mkt-line-strong px-3 py-1 text-[11px] font-medium tracking-[0.08em] text-mkt-muted uppercase">
            {/* The success token, not a raw palette colour: the design-system
                test refuses palette-level status colours outside globals.css,
                and this dot means exactly what "success" means. */}
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            Available now
          </span>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-mkt-ink sm:text-5xl">
            The official Zaino AI extension for VS Code
          </h1>
          <p className="mt-4 text-base leading-relaxed text-mkt-muted">
            Zaino AI now runs inside your editor. Pick a tier, sign in once, and
            the agent reads your codebase, edits files and runs commands — with
            your approval at every step. Billing is the same Zaino plan you
            already have.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={EXTENSION_FILE}
              download
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-mkt-ink px-5 text-sm font-medium text-mkt-bg transition-opacity hover:opacity-90"
            >
              <Download className="size-4" aria-hidden />
              Download for VS Code
            </a>
            <span className="text-[13px] text-mkt-muted">
              v{EXTENSION_VERSION}
              {size ? ` · ${size}` : ''} · .vsix
            </span>
          </div>
        </header>

        {/* ── Install: three steps, each with the value it needs ───────── */}
        <section aria-labelledby="install" className="mt-16">
          <h2
            id="install"
            className="border-b border-mkt-line pb-3 text-lg font-semibold tracking-tight text-mkt-ink"
          >
            Install
          </h2>
          <ol className="mt-6 grid gap-6">
            {INSTALL_STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[1.75rem_1fr] gap-4">
                <span className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-mkt-line-strong text-xs font-semibold tabular-nums text-mkt-muted">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-mkt-ink">{step.title}</p>
                  <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-mkt-muted">
                    {step.body}
                  </p>

                  {i === 1 ? (
                    <div className="mt-5 min-w-0">
                      <p className="text-[12px] text-mkt-muted">
                        Prefer the terminal? The same file installs with:
                      </p>
                      <CodeBlock
                        className="mt-2.5"
                        language="bash"
                        filename="install.sh"
                        code={INSTALL_COMMAND}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── What you get ─────────────────────────────────────────────── */}
        <section aria-labelledby="tiers" className="mt-16">
          <h2
            id="tiers"
            className="border-b border-mkt-line pb-3 text-lg font-semibold tracking-tight text-mkt-ink"
          >
            Four tiers, one key
          </h2>
          <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-mkt-muted">
            Switch tiers from the model picker at any time. Usage counts against
            your plan&rsquo;s token pool.
          </p>
          <dl className="mt-6 grid gap-0 overflow-hidden rounded-xl border border-mkt-line">
            {[
              { tier: 'fast', use: 'Quick edits and small questions', price: '$1.00 in · $5.00 out' },
              { tier: 'smart', use: 'Everyday coding — the default', price: '$3.00 in · $15.00 out' },
              { tier: 'frontier', use: 'Architecture and hard debugging', price: '$15.00 in · $75.00 out' },
              { tier: 'fable', use: 'Long-horizon and creative work', price: '$15.00 in · $75.00 out' },
            ].map((row) => (
              <div
                key={row.tier}
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 border-b border-mkt-line px-4 py-3 last:border-0 sm:grid-cols-[8rem_1fr_auto] sm:gap-x-4 sm:gap-y-0"
              >
                <dt className="col-start-1 row-start-1 font-mono text-[13px] font-semibold text-mkt-ink">
                  {row.tier}
                </dt>
                {/* One row on a phone (tier · price), three columns from sm up.
                    Left to stack, the price fell onto a third line and every
                    row read as a paragraph. */}
                <dd className="col-span-2 row-start-2 text-[13px] leading-relaxed text-mkt-muted sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  {row.use}
                </dd>
                <dd className="col-start-2 row-start-1 text-right font-mono text-[12px] whitespace-nowrap text-mkt-muted tabular-nums sm:col-start-3">
                  {row.price}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] text-mkt-muted">
            Per 1M tokens, USD. Cache reads bill at a tenth of the input rate.
          </p>
        </section>

        {/* ── Requirements ─────────────────────────────────────────────── */}
        <section aria-labelledby="requirements" className="mt-16">
          <h2
            id="requirements"
            className="border-b border-mkt-line pb-3 text-lg font-semibold tracking-tight text-mkt-ink"
          >
            Before you install
          </h2>
          <dl className="mt-6 grid gap-0 overflow-hidden rounded-xl border border-mkt-line">
            {REQUIREMENTS.map((row) => (
              <div
                key={row.label}
                className="grid gap-1 border-b border-mkt-line px-4 py-3 last:border-0 sm:grid-cols-[9rem_1fr] sm:gap-4"
              >
                <dt className="text-[10px] tracking-[0.1em] text-mkt-muted uppercase sm:pt-0.5">
                  {row.label}
                </dt>
                <dd className="text-[13px] leading-relaxed text-mkt-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-mkt-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The download is unsigned, so VS Code may show an unverified-publisher
            prompt. Install only from this page.
          </p>
        </section>

        {/* ── Verify ───────────────────────────────────────────────────── */}
        <section aria-labelledby="verify" className="mt-16">
          <h2
            id="verify"
            className="border-b border-mkt-line pb-3 text-lg font-semibold tracking-tight text-mkt-ink"
          >
            Already installed?
          </h2>
          <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-mkt-muted">
            Confirm the extension is registered, then open the Zaino sidebar from
            the activity bar.
          </p>
          <CodeBlock
            className="mt-4"
            language="bash"
            filename="verify.sh"
            code={verifyCommand}
          />
        </section>

        {/* ── Closing ──────────────────────────────────────────────────── */}
        <section className="mt-16 border-t border-mkt-line pt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-[46ch] text-sm leading-relaxed text-mkt-muted">
              No plan yet? The trial is three days, needs no card, and works in
              the extension.
            </p>
            <Link
              href="/sign-up"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-mkt-ink px-4 text-sm font-medium text-mkt-bg transition-opacity hover:opacity-90"
            >
              Start the trial
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <ZainoFooter />
    </div>
  );
}
