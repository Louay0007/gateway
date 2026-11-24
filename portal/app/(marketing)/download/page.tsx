import Image from 'next/image';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Minus, Terminal } from 'lucide-react';

import SiteNav from '@/components/marketing/site-nav';
import ZainoFooter from '@/components/marketing/zaino-footer';
import { CodeBlock } from '@/components/docs/code-block';

export const metadata: Metadata = {
  title: 'Zaino Agent CLI — Coming Soon',
  description: 'The Zaino Agent CLI is in development. Check back shortly.',
};

/**
 * /download — a not-yet page that has to do a job anyway.
 *
 * THE PROBLEM. The product is not shipped, so the honest answer is "not yet".
 * The old page said that in a centred block and then unspooled ~180 lines of
 * undifferentiated prose underneath: seven `h3`s, five code blocks and an
 * error list all at the same weight, on one column, with no way to skim. A
 * visitor who wanted only the base URL had to read the whole page to find it.
 *
 * THE SHAPE NOW.
 *
 *   1. A short header that says "not yet" once and immediately offers the
 *      thing that DOES work today — the same tiers, in Claude Desktop. That
 *      is the page's real job: convert a dead end into a working path.
 *   2. Three numbered steps, each with the exact value it needs, because the
 *      failure mode here is a wrong base URL, not a missing paragraph.
 *   3. A diagnostics block: the four status codes a person actually hits,
 *      as a definition list rather than as prose bullets.
 *
 * The copy is unchanged in substance — same URLs, same snippet, same codes.
 * Only the grouping changed, plus the removal of the "coming soon / until
 * then" apology framing from the body.
 */

const STEPS = [
  {
    title: 'Open Settings → Developer',
    body: 'Claude Desktop accepts a custom Anthropic-compatible endpoint under Developer. No extension, no proxy.',
  },
  {
    title: 'Add the endpoint',
    body: 'A base URL with no path, and your zn- key. The client appends /v1 itself.',
  },
  {
    title: 'Restart and pick a tier',
    body: 'The endpoint only loads at startup. Then choose claude-fast, claude-smart, claude-frontier or claude-fable.',
  },
] as const;

const DIAGNOSTICS = [
  { code: '404', meaning: 'The base URL has a trailing path. Use the bare host — the client appends /v1, so /v1/v1 is a 404.' },
  { code: '401', meaning: 'The key is wrong or revoked. Re-issue it from the dashboard; the value is shown once.' },
  { code: '403', meaning: 'The key is valid but not allowlisted for that tier. Issue a key that includes it.' },
  { code: 'Images ignored', meaning: 'Use /v1/messages, not /v1/chat/completions. Vision is stripped on the chat path.' },
] as const;

const VERIFY_CURL = `curl -s https://api.zaino.soon.it/v1/models \\
  -H "Authorization: Bearer zn-YOUR_KEY" | jq -r '.data[].id'`;

const SEND_CURL = `curl -s https://api.zaino.soon.it/v1/messages \\
  -H "x-api-key: zn-YOUR_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-smart",
    "max_tokens": 64,
    "messages": [{ "role": "user", "content": "Say ok" }]
  }'`;

export default function DownloadPage() {
  return (
    <div className="flex min-h-screen flex-col bg-mkt-bg text-mkt-ink">
      <SiteNav active="Download" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16 sm:py-20">
        {/* ── Header: say "not yet" once, then offer what works ────────── */}
        <header className="max-w-[62ch]">
          <span className="inline-flex items-center gap-2 rounded-full border border-mkt-line-strong px-3 py-1 text-[11px] font-medium tracking-[0.08em] text-mkt-muted uppercase">
            <Terminal className="size-3" aria-hidden />
            In development
          </span>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-mkt-ink sm:text-5xl">
            Zaino Agent CLI
          </h1>
          <p className="mt-4 text-base leading-relaxed text-mkt-muted">
            One command to put the gateway in your terminal. It is not shipped
            yet — and rather than leave you with a placeholder, here is the
            path that works today with the same tiers, the same key and the
            same billing.
          </p>
        </header>

        {/* ── The working path ─────────────────────────────────────────── */}
        <section aria-labelledby="workaround" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-mkt-line pb-4">
            <h2
              id="workaround"
              className="text-lg font-semibold tracking-tight text-mkt-ink"
            >
              Zaino models in Claude Desktop
            </h2>
            <span className="text-[11px] font-medium tracking-[0.08em] text-mkt-muted uppercase">
              Works now
            </span>
          </div>
          <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-mkt-muted">
            Claude Desktop speaks the Anthropic Messages API, and the gateway
            serves it. Any Zaino tier works as a custom inference endpoint with
            your existing key and billing.
          </p>

          <ol className="mt-8 grid gap-6">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[1.75rem_1fr] gap-4">
                <span className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-mkt-line-strong text-xs font-semibold tabular-nums text-mkt-muted">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-mkt-ink">{step.title}</p>
                  <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-mkt-muted">
                    {step.body}
                  </p>

                  {/* The exact values, attached to the step that needs them,
                      rather than pooled at the bottom of the page. */}
                  {i === 1 ? (
                    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border border-mkt-line bg-mkt-surface px-3 py-2">
                        <dt className="text-[10px] tracking-[0.1em] text-mkt-muted uppercase">
                          Base URL
                        </dt>
                        <dd className="mt-0.5 font-mono text-[13px] text-mkt-ink">
                          https://api.zaino.soon.it
                        </dd>
                      </div>
                      <div className="rounded-lg border border-mkt-line bg-mkt-surface px-3 py-2">
                        <dt className="text-[10px] tracking-[0.1em] text-mkt-muted uppercase">
                          API key
                        </dt>
                        <dd className="mt-0.5 font-mono text-[13px] text-mkt-ink">
                          zn-YOUR_KEY
                        </dd>
                      </div>
                    </dl>
                  ) : null}

                  {i === 2 ? (
                    <p className="mt-3 font-mono text-[13px] text-mkt-muted">
                      claude-fast · claude-smart · claude-frontier · claude-fable
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Proof: two calls that prove the whole path ───────────────── */}
        <section aria-labelledby="verify" className="mt-14">
          <h2
            id="verify"
            className="text-lg font-semibold tracking-tight text-mkt-ink"
          >
            Prove it works
          </h2>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-mkt-muted">
            Two requests. The first shows which tiers your key may call; the
            second proves the whole path — edge, gateway, model.
          </p>

          <div className="mt-6 grid min-w-0 gap-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-mkt-ink">
                Check the key's tiers
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-mkt-muted">
                If a tier is missing from this list, the key is not allowlisted
                for it — the gateway is working, the key is not.
              </p>
              <CodeBlock className="mt-3" language="bash" filename="list-models.sh" code={VERIFY_CURL} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-mkt-ink">Send one message</p>
              <CodeBlock className="mt-3" language="bash" filename="send.sh" code={SEND_CURL} />
            </div>
          </div>
        </section>

        {/* ── Diagnostics ──────────────────────────────────────────────── */}
        <section aria-labelledby="diagnostics" className="mt-14">
          <h2
            id="diagnostics"
            className="text-lg font-semibold tracking-tight text-mkt-ink"
          >
            If something is wrong
          </h2>
          <dl className="mt-5 grid gap-0 overflow-hidden rounded-xl border border-mkt-line">
            {DIAGNOSTICS.map((d) => (
              <div
                key={d.code}
                className="grid gap-1 border-b border-mkt-line px-4 py-3 last:border-0 sm:grid-cols-[9rem_1fr] sm:gap-4"
              >
                <dt className="font-mono text-[13px] font-semibold text-mkt-ink">
                  {d.code}
                </dt>
                <dd className="text-[13px] leading-relaxed text-mkt-muted">
                  {d.meaning}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-mkt-muted">
            <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Context is 1M tokens per request and up to 64K output on every
            tier. Claude Desktop may report a smaller window for model names it
            does not recognise — the gateway still accepts the full 1M.
          </p>
        </section>

        {/* ── Closing ──────────────────────────────────────────────────── */}
        <section className="mt-14 border-t border-mkt-line pt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-[46ch] text-sm leading-relaxed text-mkt-muted">
              No key yet? The trial is three days and needs no card.
            </p>
            <Link
              href="/sign-up"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-mkt-ink px-4 text-sm font-medium text-mkt-bg transition-opacity hover:opacity-90"
            >
              Get an API key
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <ZainoFooter />
    </div>
  );
}
