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

import { InstallCommands } from "@/components/marketing/install-commands";
import {
  AppleLogo,
  LinuxLogo,
  WindowsLogo,
} from "@/components/marketing/platform-logos";
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

/**
 * Download page content — the Zaino AI Agent desktop app.
 *
 * UX follows the Claude / Cursor download pattern:
 *   1. Auto-detect the visitor's OS and surface it as the primary button.
 *   2. Three platform cards with per-arch / per-format rows underneath.
 *   3. 3-step setup, system requirements, short FAQ.
 *
 * Asset resolution is three-layered, in order:
 *   1. SELF-HOSTED (/api/downloads → /downloads/v1.1.5/* on this host):
 *      direct VPS downloads, no GitHub in the path. Preferred — this is
 *      what every button uses once files are published here.
 *   2. GITHUB RELEASE (pinned v1.1.5 URLs + live Releases API match):
 *      fallback while the self-hosted mirror fills up, and the permanent
 *      fallback for files never mirrored here. If the release isn't
 *      published yet the page says so instead of serving 404s.
 */

// The desktop app below is the Zaino AI Agent — standalone desktop client
// (releases at Louay0007/zaino-desktop), pointed at the Zaino gateway.
// Every button resolves against the self-hosted mirror first,
// with the GitHub release as fallback.
const REPO = "Louay0007/zaino-desktop";
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;

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
        fallbackHref: "https://github.com/Louay0007/zaino-desktop/releases/download/v1.1.5/zaino-desktop-mac-arm64.dmg",
        match: (n) => n === "zaino-desktop-mac-arm64.dmg",
      },
      {
        id: "mac-x64",
        label: "Intel",
        hint: "Intel Macs · x64",
        wants: { os: "macos", arch: "x64", label: "Intel" },
        fallbackHref: "https://github.com/Louay0007/zaino-desktop/releases/download/v1.1.5/zaino-desktop-mac-x64.dmg",
        match: (n) => n === "zaino-desktop-mac-x64.dmg",
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
        hint: "x64 · .exe",
        wants: { os: "windows", arch: "x64", label: "Windows 10+" },
        fallbackHref: "https://github.com/Louay0007/zaino-desktop/releases/download/v1.1.5/zaino-desktop-win-x64.exe",
        match: (n) => n === "zaino-desktop-win-x64.exe",
      },
      {
        id: "win-arm64",
        label: "Windows ARM64",
        hint: "Snapdragon / ARM · .exe",
        wants: { os: "windows", arch: "arm64", label: "Windows ARM64" },
        fallbackHref: "https://github.com/Louay0007/zaino-desktop/releases/download/v1.1.5/zaino-desktop-win-arm64.exe",
        match: (n) => n === "zaino-desktop-win-arm64.exe",
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
        fallbackHref: "https://github.com/Louay0007/zaino-desktop/releases/download/v1.1.5/zaino-desktop-linux-x86_64.AppImage",
        match: (n) => n.toLowerCase().endsWith(".appimage") && !n.endsWith(".sig"),
      },
      {
        id: "linux-deb",
        label: ".deb",
        hint: "Debian · Ubuntu",
        wants: { os: "linux", arch: "x64", label: ".deb" },
        fallbackHref: "https://github.com/Louay0007/zaino-desktop/releases/download/v1.1.5/zaino-desktop-linux-amd64.deb",
        match: (n) => n === "zaino-desktop-linux-amd64.deb",
      },
      {
        id: "linux-rpm",
        label: ".rpm",
        hint: "Fedora · RHEL",
        wants: { os: "linux", arch: "x64", label: ".rpm" },
        fallbackHref: "https://github.com/Louay0007/zaino-desktop/releases/download/v1.1.5/zaino-desktop-linux-x86_64.rpm",
        match: (n) => n.toLowerCase().endsWith(".rpm") && !/arm64|aarch64/.test(n.toLowerCase()),
      },
      {
        id: "linux-arm64",
        label: "Linux ARM64",
        hint: "AppImage · .deb · .rpm",
        wants: { os: "linux", arch: "arm64", label: "AppImage" },
        fallbackHref: "https://github.com/Louay0007/zaino-desktop/releases/download/v1.1.5/zaino-desktop-linux-arm64.AppImage",
        match: (n) => /arm64|aarch64/.test(n.toLowerCase()) && (n.toLowerCase().endsWith(".appimage") || n.toLowerCase().endsWith(".deb") || n.toLowerCase().endsWith(".rpm")),
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
    title: "Install Zaino AI Agent",
    body: "Download the installer for your OS above and run it. No admin rights needed on macOS and Windows.",
  },
  {
    icon: <KeyRound className="size-4" />,
    title: "Sign in with Zaino",
    body: "The app opens your browser to approve the device — no key to copy. The key it receives lives in your OS keychain, never on disk.",
  },
  {
    icon: <MessageSquare className="size-4" />,
    title: "Pick a model and chat",
    body: "Fast for everyday speed, Smart for hard reasoning. Only the models your plan allows appear in the picker.",
  },
];

const REQUIREMENTS: { os: string; detail: string }[] = [
  { os: "macOS", detail: "macOS 12 Monterey or later · Apple Silicon and Intel" },
  { os: "Windows", detail: "Windows 10 1809 or later · x64 and ARM64 · WebView2 embedded" },
  { os: "Linux", detail: "Ubuntu 24.04+ / Debian 12+ for .deb · FUSE for AppImage · x86_64 and ARM64" },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Do I need a paid plan to use the desktop app?",
    a: "The app itself is free. You need a Zaino account with prompt quota — any plan works, including trial credit. Fast and Smart draw from your plan's prompt limits, and only the models your plan allows appear in the picker.",
  },
  {
    q: "How do I sign in?",
    a: "On first launch, choose “Sign in with Zaino”. The app opens your browser to approve the device, then hands the key to your OS keychain. There is no key to copy and no key on disk. If the browser flow is unavailable, a paste-a-key fallback is provided.",
  },
  {
    q: "How do updates work?",
    a: "The app checks for updates in the background and installs them in place. You'll see the release notes the first time you open a new version.",
  },
  {
    q: "Is my API key safe on my machine?",
    a: "Yes. The key is stored in your OS keychain and held only in memory while the app runs. Config files and logs only ever see a reference to the environment variable — never the key itself.",
  },
  {
    q: "Is this the same as the old Zaino AI Agent download?",
    a: "Yes — this page, this app, one name. Older bookmarks pointing at early builds land here, on the same client, signed in the same way.",
  },
];

export default function DownloadContent() {
  const [os, setOs] = React.useState<OsId>(null);
  const [hosted, setHosted] = React.useState<HostedFile[] | null>(null);
  const [live, setLive] = React.useState<LiveAsset[] | null>(null);
  const [releaseMissing, setReleaseMissing] = React.useState(false);
  const [releaseTag, setReleaseTag] = React.useState<string | null>(null);

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
    // Layer 2: our standalone desktop release. `latest` moves on every
    // release, and the asset names below are stable across releases.
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
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
        if (typeof data?.tag_name === "string") setReleaseTag(data.tag_name);
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
          {releaseTag ? `${releaseTag} · now available` : "Latest release"}
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 md:text-5xl">
          Zaino AI Agent
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-gray-600 dark:text-gray-400">
          The official Zaino desktop client — Fast, Smart and Frontier,
          ready to sign in with your gateway account.
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
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <Check className="size-3.5" />
            Direct download from our server — no account needed
          </p>
        ) : null}
        {releaseMissing ? (
          <p className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 text-sm text-amber-700">
            <Info className="size-4 shrink-0" />
            Installers are being published right now — if a
            button misses, grab it from the release page.
          </p>
        ) : null}
      </div>

      {/* ── Installation commands (Claude Code CLI) ──────────────────── */}
      <InstallCommands />

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
                  ? "border-gray-900 dark:border-gray-100 ring-1 ring-gray-900 dark:ring-gray-100 shadow-sm"
                  : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700",
              )}
            >
              {isDetected ? (
                <div className="absolute inset-x-0 top-0 h-1 bg-gray-900 dark:bg-gray-100" />
              ) : null}
              {isDetected ? (
                <Badge className="absolute right-4 top-4 z-10 bg-gray-900 dark:bg-gray-700 text-white hover:bg-gray-800 dark:hover:bg-gray-600">
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
                        ? "bg-gray-900 dark:bg-gray-700 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 group-hover:bg-gray-900 dark:group-hover:bg-gray-700 group-hover:text-white",
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
                          ? "border-gray-200 dark:border-gray-800 bg-gray-900/[0.02] dark:bg-gray-100/[0.02]"
                          : "border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {row.label}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                          {row.hint}
                          {resolved.size ? (
                            <span className="font-medium text-gray-700 dark:text-gray-300">
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
                              ? "bg-gray-900 dark:bg-gray-700 text-white hover:bg-gray-800 dark:hover:bg-gray-600"
                              : "border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 hover:border-gray-900 dark:hover:border-gray-100 hover:bg-gray-900 dark:hover:bg-gray-700 hover:text-white",
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
                          className="h-8 shrink-0 rounded-lg border-gray-200 dark:border-gray-800 px-3 text-xs font-medium text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700 hover:text-gray-900 dark:hover:text-gray-100"
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
        <h2 className="text-center text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Up and running in three steps
        </h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Card key={step.title}>
              <CardContent className="grid gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-gray-900 dark:bg-gray-700 text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                    {step.icon}
                  </span>
                </div>
                <p className="font-medium text-gray-900 dark:text-gray-100">{step.title}</p>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{step.body}</p>
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
                className="flex flex-col gap-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-3"
              >
                <span className="shrink-0 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {r.os}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{r.detail}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4" />
              What&apos;s inside
            </CardTitle>
            <CardDescription>Models, locked tiers, updates</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-gray-700 dark:text-gray-300">
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Fast — Haiku 5.5, served on Zaino official infrastructure.
            </p>
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Smart — Sonnet 5.5, served on Zaino official infrastructure.
            </p>
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Frontier — Opus 5.5 on Zaino official infrastructure, Pro only.
            </p>
            <p className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              In-app updates from our official GitHub releases. Nothing to
              reinstall, ever.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <div className="mx-auto mt-16 max-w-3xl">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Frequently asked
        </h2>
        <div className="mt-8 grid gap-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="group rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-4 open:shadow-sm"
            >
              <summary className="cursor-pointer list-none text-sm font-medium text-gray-900 dark:text-gray-100 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-4">
                  {f.q}
                  <ArrowUpRight className="size-4 shrink-0 text-gray-500 dark:text-gray-400 transition-transform group-open:rotate-90" />
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
