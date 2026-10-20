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
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 0 0-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 0 0-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 0 1-.004-.021l-.004-.024a1.807 1.807 0 0 1-.15.706.953.953 0 0 1-.213.335.71.71 0 0 0-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 0 0-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 0 0-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 0 0-.205.334 1.18 1.18 0 0 0-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 0 1-.018-.2v-.02a1.772 1.772 0 0 1 .15-.768 1.08 1.08 0 0 1 .43-.533.985.985 0 0 1 .594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 0 0-.166-.267.248.248 0 0 0-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 0 0-.12.27.944.944 0 0 0-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 0 1-.131.068 2.62 2.62 0 0 1-.275-.402 1.772 1.772 0 0 1-.155-.667 1.759 1.759 0 0 1 .08-.668 1.43 1.43 0 0 1 .283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 0 1 .016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 0 1-.448-.067 3.566 3.566 0 0 1-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 0 0-.402-.533 1.45 1.45 0 0 0-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 0 0 .314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 0 1 .647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 0 1-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" />
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
