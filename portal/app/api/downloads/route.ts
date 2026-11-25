/**
 * GET /api/downloads — the public release list for /download.
 *
 * UNAUTHENTICATED BY DESIGN: this is the backing data for the public
 * /download page. It answers the same question a visitor could answer by
 * reading the page HTML — which files exist, their names, sizes, and the
 * direct URLs — so there is nothing here that needs a session.
 *
 * The /download page links its button straight at `/downloads/…`, so this
 * route is not what serves the file — it is the machine-readable index of
 * what is published: the release version plus one row per artifact.
 *
 * Files live in DOWNLOADS_DIR (default `/app/data/downloads`), laid out flat
 * (`zaino-1.0.0.vsix`) or per version (`<version>/zaino-1.0.0.vsix`). Files
 * are classified by extension; anything unrecognised is skipped, never
 * listed — the classifier is the serving policy.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || "/app/data/downloads";
const CURRENT_VERSION = "1.0.0";

interface DownloadFile {
  name: string;
  url: string;
  size: number;
  os: "macos" | "windows" | "linux" | "any";
  arch: string;
  label: string;
  kind: "extension" | "installer";
}

function classify(name: string): Omit<DownloadFile, "name" | "url" | "size"> | null {
  const lower = name.toLowerCase();
  // The official extension: zaino-<version>.vsix. One file, every platform.
  if (lower.endsWith(".vsix")) {
    return { os: "any", arch: "any", label: "VS Code extension", kind: "extension" };
  }
  // macOS: zaino-desktop-mac-arm64.dmg / zaino-desktop-mac-x64.dmg
  if (lower.endsWith(".dmg")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return {
      os: "macos",
      arch,
      label: arch === "arm64" ? "Apple Silicon" : "Intel",
      kind: "installer",
    };
  }
  // Windows: zaino-desktop-win-x64.exe / zaino-desktop-win-arm64.exe
  if (lower.endsWith(".exe")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return {
      os: "windows",
      arch,
      label: arch === "arm64" ? "Windows ARM64" : "Windows 10+",
      kind: "installer",
    };
  }
  // Linux AppImage: zaino-desktop-linux-x86_64.AppImage / zaino-desktop-linux-arm64.AppImage
  if (lower.endsWith(".appimage")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return { os: "linux", arch, label: "AppImage", kind: "installer" };
  }
  // Linux .deb: zaino-desktop-linux-amd64.deb / zaino-desktop-linux-arm64.deb
  if (lower.endsWith(".deb")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return { os: "linux", arch, label: ".deb", kind: "installer" };
  }
  // Linux .rpm: zaino-desktop-linux-x86_64.rpm / zaino-desktop-linux-aarch64.rpm
  if (lower.endsWith(".rpm")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return { os: "linux", arch, label: ".rpm", kind: "installer" };
  }
  return null;
}

/** Directories a release may live in: per-version, then flat. */
function releaseDirs(): { dir: string; urlPrefix: string }[] {
  return [
    { dir: join(DOWNLOADS_DIR, `v${CURRENT_VERSION}`), urlPrefix: `/downloads/v${CURRENT_VERSION}` },
    { dir: DOWNLOADS_DIR, urlPrefix: "/downloads" },
  ];
}

export async function GET(): Promise<Response> {
  const files: DownloadFile[] = [];
  const seen = new Set<string>();

  for (const { dir, urlPrefix } of releaseDirs()) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      // Missing directory = nothing published there; keep looking.
      continue;
    }

    for (const name of entries) {
      // Dotfiles, signatures, and anything unclassified are never listed.
      if (name.startsWith(".") || name.endsWith(".sig")) continue;
      if (seen.has(name)) continue;
      const meta = classify(name);
      if (!meta) continue;
      try {
        const s = await stat(join(dir, name));
        if (!s.isFile()) continue;
        seen.add(name);
        files.push({
          name,
          url: `${urlPrefix}/${encodeURIComponent(name)}`,
          size: s.size,
          ...meta,
        });
      } catch {
        // A file that vanishes mid-listing is skipped, not fatal.
      }
    }
  }

  return Response.json(
    { version: CURRENT_VERSION, files },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
