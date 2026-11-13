import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import { ConnectPicker } from "@/components/connect/connect-picker";
import { currentUser } from "@/lib/auth/authorize";

export const metadata: Metadata = {
  title: "Connect | Zaino AI",
  description:
    "Pick your tool, pick a tier, paste your key — one block that ends in a 200. Claude Code, Codex, Cursor, Zed, Continue, Aider, the OpenAI and Anthropic SDKs, LangChain, LlamaIndex, n8n, Open WebUI, or plain curl.",
};

/**
 * /connect — the conversion page.
 *
 * WHY IT IS THE HIGHEST-LEVERAGE PAGE IN THE REPO. Every other page asks a
 * question; this one answers the only one a developer has after signing up:
 * "what do I paste?" Today that answer lives partly in /docs, partly in
 * memory, and partly nowhere — so a paying customer with a valid key has to
 * reverse-engineer an integration.
 *
 * It is server-rendered only to resolve whether the visitor is signed in.
 * The snippet generator runs on the client so the block updates the instant
 * a pick changes; nothing here touches the database or the gateway.
 *
 * `force-dynamic` because of that `currentUser()` call: the page reads
 * cookies, and a build-time prerender would bake in the signed-out variant.
 */
export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const user = await currentUser();

  return (
    <>
      <SiteNav active="Connect" />
      <main className="pt-16">
        <section className="border-b border-border bg-background py-14 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-medium text-muted-foreground">Connect</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
              Three picks, one block, a 200.
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Zaino speaks the OpenAI and Anthropic wire formats natively, so
              whatever you already use works — only the base URL and the key
              change. There is no SDK to install, because the SDKs you already
              have speak our API.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {user ? (
                <>
                  You are signed in as{" "}
                  <span className="font-medium text-foreground">{user.email}</span>
                  .{" "}
                  <Link
                    href="/dashboard/keys"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    Open your keys
                  </Link>{" "}
                  to copy one into the field below.
                </>
              ) : (
                <>
                  You do not need an account to read the blocks.{" "}
                  <Link
                    href="/sign-up"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    Sign up
                  </Link>{" "}
                  when you want a real <code className="font-mono">zn-</code> key
                  — 3-day trial, no card.
                </>
              )}
            </p>
          </div>
        </section>

        <section className="bg-background py-12 sm:py-16">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <ConnectPicker signedIn={Boolean(user)} />
          </div>
        </section>

        <section className="border-t border-border bg-background py-12">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:p-8">
              <div>
                <p className="text-lg font-semibold tracking-tight text-foreground">
                  Something not on the list?
                </p>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  If it can talk to an OpenAI- or Anthropic-compatible endpoint,
                  it works — point it at our base URL and give it a{" "}
                  <code className="font-mono text-[13px]">zn-</code> key. The
                  full reference is in the docs.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3">
                <Link
                  href="/docs"
                  className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
                >
                  Read the docs
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Ask us
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <ZainoFooter />
    </>
  );
}
