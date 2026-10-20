"use client";

import * as React from "react";
import {
  ArrowUpRight,
  Check,
  Cpu,
  Download,
  Info,
  KeyRound,
  MessageSquare,
  Package,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/* ── Platform logos (official SVG paths) ─────────────────────────── */

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 384 512" className={className} fill="currentColor" aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 52.3-11.4 69.5-34.3z" />
    </svg>
  );
}

function WindowsLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 448 512" className={className} fill="currentColor" aria-hidden="true">
      <path d="M0 93.7l183.6-25.3v177.4H0V93.7zm0 324.6l183.6 25.3V268.4H0v149.9zm203.8 28L448 480V268.4H203.8v177.9zm0-380.7v177.4H448V32L203.8 65.6z" />
    </svg>
  );
}

function LinuxLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2C8.5 2 6 4.5 6 7c0 1.5.5 3 1.5 4C6 12.5 5 14 5 16c0 2.5 2 4 4.5 4h5c2.5 0 4.5-1.5 4.5-4 0-2-1-3.5-2.5-5 1-1 1.5-2.5 1.5-4 0-2.5-2.5-5-6-5zm-2 9c-.5 0-1-.5-1-1s.5-1 1-1 1 .5 1 1-.5 1-1 1zm4 0c-.5 0-1-.5-1-1s.5-1 1-1 1 .5 1 1-.5 1-1 1z"/>
    </svg>
  );
}

/**
 * Download page content — Zaino AI Agent desktop installers.
 *
 * UX follows the Claude / Cursor download pattern:
 *   1. Auto-detect the visitor's OS and surface it as the primary button.
 *   2. Three platform cards with per-arch / per-format rows underneath.
 *   3. 3-step setup, system requirements, short FAQ.
 *
 * Asset resolution is three-layered, in order:
 *   1. SELF-HOSTED (/api/downloads → /downloads/v1.0.1/* on this host):
 *      direct VPS downloads, no GitHub in the path. Preferred — this is
 *      what every button uses once files are published here.
 *   2. GITHUB RELEASE (pinned v1.0.1 URLs + live Releases API match):
 *      fallback while the self-hosted mirror fills up, and the permanent
 *      fallback for files never mirrored here. If the release isn't
 *      published yet the page says so instead of serving 404s.
 */

const REPO = "Louay0007/zaino-ai-agent";
const PINNED_VERSION = "1.0.1";
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;
const PINNED_BASE = `https://github.com/${REPO}/releases/download/v${PINNED_VERSION}`;

type OsId = "macos" | "windows" | "linux" | null;

interface AssetRow {
  id: string;
  label: string;
  hint: string;
  /** OS/arch/format the self-hosted API match must carry. */
  wants: { os: "macos" | "windows" | "linux"; arch: string; label: string };
  /** GitHub fallback URL — used until the self-hosted mirror has it. */
  fallbackHref: string | null;
  /** Extension matcher against the live GitHub release assets. */
  match: (name: string) => boolean;
}

interface Platform {
  id: Exclude<OsId, null>;
  name: string;
  tagline: string;
  icon: React.ReactNode;
  rows: AssetRow[];
}

const PLATFORMS: Platform[] = [
  {
    id: "macos",
    name: "macOS",
    tagline: "Apple Silicon DMG (unsigned preview)",
    icon: <AppleLogo className="size-5" />,
    rows: [
      {
        id: "mac-arm64",
        label: "Apple Silicon",
        hint: "M1, M2, M3, M4 · arm64",
        wants: { os: "macos", arch: "arm64", label: "Apple Silicon" },
        fallbackHref: `${PINNED_BASE}/zaino-ai-agent_${PINNED_VERSION}_aarch64.dmg`,
        match: (n) => n.endsWith(".dmg") && /aarch64|arm64/i.test(n),
      },
    ],
  },
  {
    id: "windows",
    name: "Windows",
    tagline: "NSIS installer, WebView2 included",
    icon: <WindowsLogo className="size-5" />,
    rows: [
      {
        id: "win-x64",
        label: "Windows 10+",
        hint: "x64 setup · .exe",
        wants: { os: "windows", arch: "x64", label: "Windows 10+" },
        fallbackHref: `${PINNED_BASE}/Zaino.AI.Agent_${PINNED_VERSION}_x64-setup.exe`,
        match: (n) => n.endsWith("-setup.exe") && !n.endsWith(".sig"),
      },
    ],
  },
  {
    id: "linux",
    name: "Linux",
    tagline: "AppImage, .deb and .rpm",
    icon: <LinuxLogo className="size-5" />,
    rows: [
      {
        id: "linux-appimage",
        label: "AppImage",
        hint: "Runs anywhere · x86_64",
        wants: { os: "linux", arch: "x64", label: "AppImage" },
        fallbackHref: null,
        match: (n) => n.endsWith(".AppImage") && !n.endsWith(".sig"),
      },
      {
        id: "linux-deb",
        label: ".deb",
        hint: "Debian · Ubuntu",
        wants: { os: "linux", arch: "x64", label: ".deb" },
        fallbackHref: `${PINNED_BASE}/zaino-ai-agent_${PINNED_VERSION}_amd64.deb`,
        match: (n) => n.endsWith(".deb"),
      },
      {
        id: "linux-rpm",
        label: ".rpm",
        hint: "Fedora · RHEL",
        wants: { os: "linux", arch: "x64", label: ".rpm" },
        fallbackHref: null,
        match: (n) => n.endsWith(".rpm") && !n.endsWith(".sig"),
      },
    ],
  },
];

interface LiveAsset {
  name: string;
  url: string;
  size: number;
}

interface HostedFile {
  name: string;
  url: string;
  size: number;
  os: string;
  arch: string;
  label: string;
}

function detectOs(): OsId {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent.toLowerCase();
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform?.toLowerCase() ??
    (navigator.platform || "").toLowerCase();
  if (/mac|darwin|iphone|ipad/.test(platform) || /mac os/.test(ua)) return "macos";
  if (/win/.test(platform) || /windows/.test(ua)) return "windows";
  if (/linux|android|x11/.test(platform) || /linux/.test(ua)) return "linux";
  return null;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

const STEPS = [
  {
    icon: <Download className="size-4" />,
    title: "Install the app",
    body: "Download the installer for your OS above and run it. No admin rights needed on macOS and Windows.",
  },
  {
    icon: <KeyRound className="size-4" />,
    title: "Sign in with your device key",
    body: "Create an API key from your Zaino dashboard, then paste it in the app. It lives in your OS keychain — never on disk.",
  },
  {
    icon: <MessageSquare className="size-4" />,
    title: "Pick a model and chat",
    body: "Fast runs on Sonnet 5, Smart on Opus 5.5. Frontier (Fable 5.1) unlocks soon — the app updates itself when it lands.",
  },
];

const REQUIREMENTS: { os: string; detail: string }[] = [
  { os: "macOS", detail: "macOS 12 Monterey or later · Apple Silicon (Intel coming soon)" },
  { os: "Windows", detail: "Windows 10 1809 or later · x64 · WebView2 embedded" },
  { os: "Linux", detail: "Ubuntu 24.04+ / Debian 12+ for .deb · FUSE for AppImage" },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: 'macOS says "damaged" or "can\'t be opened" — what do I do?',
    a: 'The current preview build is not yet notarized by Apple. After dragging the app to Applications, open Terminal and run: xattr -cr /Applications/Zaino\\ AI\\ Agent.app — then launch it normally. This one-time step removes the quarantine flag. Signed & notarized builds are coming in the next release.',
  },
  {
    q: "Do I need a paid plan to use the desktop app?",
    a: "The app itself is free. You need a Zaino API key with prompt quota — any plan works, including trial credit. Fast (Sonnet 5) and Smart (Opus 5.5) draw from your plan's prompt limits.",
  },
  {
    q: "How do updates work?",
    a: "The app checks our GitHub releases in the background and installs updates in place. You'll see the release notes the first time you open a new version.",
  },
  {
    q: "Is my API key safe on my machine?",
    a: "Yes. The key is stored in your OS keychain and held only in memory while the app runs. Config files and logs only ever see per-send dummy tokens — never your real key.",
  },
  {
    q: "When does Frontier (Fable 5.1) unlock?",
    a: "Frontier is hidden from the model picker for now while we finish Pro-plan metering. It will appear automatically via an app update — no reinstall needed.",
  },
];

export default function DownloadContent() {
  const [os, setOs] = React.useState<OsId>(null);
  const [hosted, setHosted] = React.useState<HostedFile[] | null>(null);
  const [live, setLive] = React.useState<LiveAsset[] | null>(null);
  const [releaseMissing, setReleaseMissing] = React.useState(false);

  React.useEffect(() => {
    setOs(detectOs());
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    // Layer 1: self-hosted mirror on this host. Preferred for every button.
    fetch("/api/downloads")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.files) return;
        setHosted(data.files as HostedFile[]);
      })
      .catch(() => {
        /* GitHub fallback below still works without the mirror */
      });
    // Layer 2: GitHub release as fallback while the mirror fills up.
    fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${PINNED_VERSION}`)
      .then((r) => {
        if (r.status === 404) {
          if (!cancelled) setReleaseMissing(true);
          return null;
        }
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (cancelled || !data?.assets) return;
        setLive(
          (data.assets as { name: string; browser_download_url: string; size: number }[])
            .filter((a) => !a.name.endsWith(".sig"))
            .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
        );
      })
      .catch(() => {
        /* self-hosted layer above still works offline of the API */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolveRow = React.useCallback(
    (row: AssetRow): { href: string | null; size: string; direct: boolean } => {
      // Self-hosted first: exact os/arch/label match from /api/downloads.
      if (hosted) {
        const hit = hosted.find(
          (f) => f.os === row.wants.os && f.arch === row.wants.arch && f.label === row.wants.label,
        );
        if (hit) return { href: hit.url, size: formatBytes(hit.size), direct: true };
      }
      // GitHub live match second, pinned URL last.
      if (live) {
        const hit = live.find((a) => row.match(a.name));
        if (hit) return { href: hit.url, size: formatBytes(hit.size), direct: false };
      }
      return { href: row.fallbackHref, size: "", direct: false };
    },
    [hosted, live],
  );

  const primary = React.useMemo(() => {
    if (!os) return null;
    const platform = PLATFORMS.find((p) => p.id === os);
    if (!platform) return null;
    const row = platform.rows[0];
    if (!row) return null;
    const resolved = resolveRow(row);
    return { platform, row, ...resolved };
  }, [os, resolveRow]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-28 pb-16 sm:px-6 lg:px-8">
      {/* ── Hero ─────────────────────────────────────────── */}
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="secondary" className="mb-4">
          <span className="size-1.5 rounded-full bg-emerald-600" />
          v{PINNED_VERSION} · now available
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-black md:text-5xl">
          Zaino AI Agent for desktop
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-black/60">
          Fast on Sonnet 5, Smart on Opus 5.5 — your gateway models in a
          native app for macOS, Windows, and Linux.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {primary?.href ? (
            <Button
              size="lg"
              className="h-12 rounded-full px-7 text-base"
              nativeButton={false}
              render={
                <a href={primary.href} download>
                  <Download className="size-4" />
                  Download for {primary.platform.name}
                  {primary.size ? (
                    <span className="opacity-70">· {primary.size}</span>
                  ) : null}
                </a>
              }
            />
          ) : (
            <Button
              size="lg"
              className="h-12 rounded-full px-7 text-base"
              nativeButton={false}
              render={
                <a href="#platforms">
                  <Download className="size-4" />
                  Download for {primary?.platform.name ?? "your OS"}
                </a>
              }
            />
          )}
          <Button
            size="lg"
            variant="outline"
            className="h-12 rounded-full px-7 text-base"
            nativeButton={false}
            render={
              <a href={RELEASE_PAGE} target="_blank" rel="noreferrer">
                Release notes
                <ArrowUpRight className="size-4" />
              </a>
            }
          />
        </div>
        {primary?.direct ? (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-emerald-700">
            <Check className="size-3.5" />
            Direct download from our server — no account needed
          </p>
        ) : null}
        {releaseMissing ? (
          <p className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 text-sm text-amber-700">
            <Info className="size-4 shrink-0" />
            v{PINNED_VERSION} installers are being published right now — if a
            button misses, grab it from the release page.
          </p>
        ) : null}
      </div>

      {/* ── Platform cards ───────────────────────────────── */}
      <div id="platforms" className="mt-16 grid scroll-mt-24 gap-6 md:grid-cols-3">
        {PLATFORMS.map((platform) => {
          const isDetected = os === platform.id;
          return (
            <Card
              key={platform.id}
              className={cn(
                "relative flex flex-col overflow-hidden transition-all duration-200 hover:shadow-md",
                isDetected
                  ? "border-black ring-1 ring-black shadow-sm"
                  : "border-black/10 hover:border-black/20",
              )}
            >
              {isDetected ? (
                <div className="absolute inset-x-0 top-0 h-1 bg-black" />
              ) : null}
              {isDetected ? (
                <Badge className="absolute right-4 top-4 z-10 bg-black text-white hover:bg-black/90">
                  <Check className="mr-1 size-3" />
                  Detected
                </Badge>
              ) : null}
              <CardHeader className="pb-4">
                <div className="flex items-center gap-4">
                  <span
                    className={cn(
                      "flex size-12 items-center justify-center rounded-2xl transition-colors",
                      isDetected
                        ? "bg-black text-white"
                        : "bg-gray-100 text-black group-hover:bg-black group-hover:text-white",
                    )}
                  >
                    {platform.icon}
                  </span>
                  <div>
                    <CardTitle className="text-xl">{platform.name}</CardTitle>
                    <CardDescription className="mt-0.5">
                      {platform.tagline}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3 pt-0">
                {platform.rows.map((row) => {
                  const resolved = resolveRow(row);
                  return (
                    <div
                      key={row.id}
                      className={cn(
                        "group/row flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors",
                        isDetected
                          ? "border-black/10 bg-black/[0.02]"
                          : "border-black/5 hover:border-black/10 hover:bg-gray-50",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-black">
                          {row.label}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-black/50">
                          {row.hint}
                          {resolved.size ? (
                            <span className="font-medium text-black/70">
                              {" "}
                              · {resolved.size}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      {resolved.href ? (
                        <Button
                          size="sm"
                          variant={isDetected ? "default" : "outline"}
                          className={cn(
                            "h-8 shrink-0 rounded-lg px-3 text-xs font-medium transition-all",
                            isDetected
                              ? "bg-black text-white hover:bg-black/85"
                              : "border-black/10 text-black hover:border-black hover:bg-black hover:text-white",
                          )}
                          nativeButton={false}
                          render={
                            <a href={resolved.href} download>
                              <Download className="mr-1.5 size-3.5" />
                              Get
                            </a>
                          }
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 rounded-lg border-black/10 px-3 text-xs font-medium text-black/60 hover:border-black/20 hover:text-black"
                          nativeButton={false}
                          render={
                            <a
                              href={RELEASE_PAGE}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View
                            </a>
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Setup steps ──────────────────────────────────── */}
      <div className="mt-16">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-black">
          Up and running in three steps
        </h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Card key={step.title}>
              <CardContent className="grid gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-lg bg-black/5 text-black">
                    {step.icon}
                  </span>
                </div>
                <p className="font-medium text-black">{step.title}</p>
                <p className="text-sm leading-relaxed text-black/60">{step.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Requirements + models ────────────────────────── */}
      <div className="mt-16 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4" />
              System requirements
            </CardTitle>
            <CardDescription>What each installer needs</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {REQUIREMENTS.map((r) => (
              <div
                key={r.os}
                className="flex flex-col gap-0.5 rounded-lg bg-black/[0.03] px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-3"
              >
                <span className="shrink-0 text-sm font-medium text-black">
                  {r.os}
                </span>
                <span className="text-sm text-black/60">{r.detail}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4" />
              What&apos;s inside v{PINNED_VERSION}
            </CardTitle>
            <CardDescription>Models, locked tiers, updates</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-black/70">
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Fast — powered by Sonnet 5 for everyday speed.
            </p>
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Smart — powered by Opus 5.5 for hard reasoning.
            </p>
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Frontier (Fable 5.1) stays hidden until Pro metering lands —
              then it appears via auto-update.
            </p>
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              In-app updates from our official GitHub releases. Nothing to
              reinstall, ever.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <div className="mx-auto mt-16 max-w-3xl">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-black">
          Frequently asked
        </h2>
        <div className="mt-8 grid gap-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="group rounded-xl border border-black/10 bg-white px-5 py-4 open:shadow-sm"
            >
              <summary className="cursor-pointer list-none text-sm font-medium text-black [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-4">
                  {f.q}
                  <ArrowUpRight className="size-4 shrink-0 text-black/40 transition-transform group-open:rotate-90" />
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-black/60">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
