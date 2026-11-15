import type { Metadata } from 'next';
import SiteNav from '@/components/marketing/site-nav';
import ZainoFooter from '@/components/marketing/zaino-footer';

export const metadata: Metadata = {
  title: 'Zaino Agent CLI — Coming Soon',
  description: 'The Zaino Agent CLI is in development. Check back shortly.',
};

/** One command, one copy target, one look. */
function Command({ label, children }: { label: string; children: string }) {
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <pre className="overflow-x-auto rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-3">
      <span className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-white/15 text-xs tabular-nums text-muted-foreground">
        {n}
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export default function DownloadPage() {
  return (
    <div className="flex min-h-screen flex-col bg-black text-foreground">
      <SiteNav active="Download" />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-20">
        {/* ── Coming soon ────────────────────────────────────────── */}
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Coming soon
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Zaino Agent CLI
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
            One command to put the gateway in your terminal. In development.
          </p>
        </div>

        {/* ── Until then, use Claude Desktop ─────────────────────── */}
        <div className="mt-20 border-t border-white/10 pt-12">
          <h2 className="text-lg font-semibold tracking-tight">
            Until then: Zaino models in Claude Desktop
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Claude Desktop speaks the Anthropic Messages API. The gateway serves
            it, so any Zaino tier works as a custom inference endpoint — with
            your existing API key and billing.
          </p>

          <h3 className="mt-8 text-sm font-medium">Before you start</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            You need Claude Desktop installed, and a Zaino API key. Open{' '}
            <code className="rounded bg-white/5 px-1 py-0.5 text-xs">
              /dashboard/api-keys
            </code>{' '}
            and issue one with the tiers you want to use.
          </p>

          <h3 className="mt-8 text-sm font-medium">Check the gateway answers</h3>
          <Command label="Your key should list the models it may use">
            {`curl -s https://api.zaino.soon.it/v1/models \\
  -H "Authorization: Bearer zn-YOUR_KEY" | jq -r '.data[].id'`}
          </Command>
          <p className="mt-2 text-xs text-muted-foreground">
            If a tier is missing from that list, your key is not allowlisted for
            it — the gateway is working, the key is not.
          </p>

          <h3 className="mt-8 text-sm font-medium">Add the endpoint</h3>
          <ol className="mt-3 grid gap-5">
            <Step n={1} title="Open Settings">
              In Claude Desktop, go to <strong>Settings</strong>, then{' '}
              <strong>Developer</strong>, then <strong>Edit Config</strong>.
            </Step>
            <Step n={2} title="Add a custom inference endpoint">
              Under <strong>Developer</strong>, add an Anthropic-compatible
              endpoint. Enter the base URL and your key:
            </Step>
          </ol>

          <Command label="Base URL">
            {`https://api.zaino.soon.it`}
          </Command>
          <Command label="API key">
            {`zn-YOUR_KEY`}
          </Command>
          <p className="mt-2 text-xs text-muted-foreground">
            No <code className="rounded bg-white/5 px-1 py-0.5 text-xs">/v1</code>{' '}
            suffix — the client appends it. A base URL ending in{' '}
            <code className="rounded bg-white/5 px-1 py-0.5 text-xs">/v1/v1</code>{' '}
            returns 404.
          </p>

          <ol className="mt-5 grid gap-5">
            <Step n={3} title="Restart Claude Desktop">
              Quit fully and reopen. The endpoint only loads at startup.
            </Step>
            <Step n={4} title="Pick a Zaino tier">
              Use the model picker, or name the model in your request. Tiers are{' '}
              <code className="rounded bg-white/5 px-1 py-0.5 text-xs">claude-fast</code>,{' '}
              <code className="rounded bg-white/5 px-1 py-0.5 text-xs">claude-smart</code>,{' '}
              <code className="rounded bg-white/5 px-1 py-0.5 text-xs">claude-frontier</code>{' '}
              and{' '}
              <code className="rounded bg-white/5 px-1 py-0.5 text-xs">claude-fable</code>.
            </Step>
          </ol>

          <h3 className="mt-8 text-sm font-medium">Send one request</h3>
          <Command label="Proves the whole path: edge, gateway, model">
            {`curl -s https://api.zaino.soon.it/v1/messages \\
  -H "x-api-key: zn-YOUR_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-smart",
    "max_tokens": 64,
    "messages": [{ "role": "user", "content": "Say ok" }]
  }'`}
          </Command>

          <h3 className="mt-8 text-sm font-medium">If something is wrong</h3>
          <ul className="mt-2 grid gap-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">404</strong> — the base URL has
              a trailing path. Use{' '}
              <code className="rounded bg-white/5 px-1 py-0.5 text-xs">
                https://api.zaino.soon.it
              </code>{' '}
              with no <code>/v1</code>. The client appends it.
            </li>
            <li>
              <strong className="text-foreground">401</strong> — the key is wrong
              or revoked. Re-issue it from the dashboard.
            </li>
            <li>
              <strong className="text-foreground">403</strong> — the key is valid
              but not allowlisted for that tier. Issue a key that includes it.
            </li>
            <li>
              <strong className="text-foreground">Images ignored</strong> — use{' '}
              <code>/v1/messages</code>, not{' '}
              <code>/v1/chat/completions</code>. Images are stripped on the chat
              path.
            </li>
          </ul>

          <p className="mt-8 text-xs text-muted-foreground">
            Context is 1M tokens per request and up to 64K output on every tier.{' '}
            Claude Desktop may report a smaller window for model names it does
            not recognise — the gateway still accepts the full 1M.
          </p>
        </div>
      </main>

      <ZainoFooter />
    </div>
  );
}
