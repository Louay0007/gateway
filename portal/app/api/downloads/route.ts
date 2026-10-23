/**
 * GET /api/downloads — list self-hosted Zaino AI Agent installers.
 *
 * UNAUTHENTICATED BY DESIGN: this is the backing data for the public
 * /download page. It answers the same question a visitor could answer by
 * reading the page HTML — which files exist, their names, sizes, and the
 * direct URLs — so there is nothing here that needs a session.
 *
 * Files live in DOWNLOADS_DIR (default `/app/data/downloads`), laid out
 * as `<version>/<filename>`. The route reads the directory, stats each
 * file, and maps the filename to an OS/arch/format row. Unknown files
 * are skipped, never served — the allowlist below is the serving policy.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || "/app/data/downloads";
const CURRENT_VERSION = "1.1.5";

interface DownloadFile {
  name: string;
  url: string;
  size: number;
  os: "macos" | "windows" | "linux";
  arch: string;
  label: string;
}

function classify(name: string): Omit<DownloadFile, "name" | "url" | "size"> | null {
  const lower = name.toLowerCase();
  // macOS: zaino-desktop-mac-arm64.dmg / zaino-desktop-mac-x64.dmg
  if (lower.endsWith(".dmg")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return {
      os: "macos",
      arch,
      label: arch === "arm64" ? "Apple Silicon" : "Intel",
    };
  }
  // Windows: zaino-desktop-win-x64.exe / zaino-desktop-win-arm64.exe
  if (lower.endsWith(".exe")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return {
      os: "windows",
      arch,
      label: arch === "arm64" ? "Windows ARM64" : "Windows 10+",
    };
  }
  // Linux AppImage: zaino-desktop-linux-x86_64.AppImage / zaino-desktop-linux-arm64.AppImage
  if (lower.endsWith(".appimage")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return { os: "linux", arch, label: "AppImage" };
  }
  // Linux .deb: zaino-desktop-linux-amd64.deb / zaino-desktop-linux-arm64.deb
  if (lower.endsWith(".deb")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return { os: "linux", arch, label: ".deb" };
  }
  // Linux .rpm: zaino-desktop-linux-x86_64.rpm / zaino-desktop-linux-aarch64.rpm
  if (lower.endsWith(".rpm")) {
    const arch = /arm64|aarch64/.test(lower) ? "arm64" : "x64";
    return { os: "linux", arch, label: ".rpm" };
  }
  return null;
}

export async function GET(): Promise<Response> {
  let files: DownloadFile[] = [];
  try {
    const dir = join(DOWNLOADS_DIR, `v${CURRENT_VERSION}`);
    const entries = await readdir(dir);
    for (const name of entries) {
      // Dotfiles, signatures, and anything unclassified are never listed.
      if (name.startsWith(".") || name.endsWith(".sig")) continue;
      const meta = classify(name);
      if (!meta) continue;
      try {
        const s = await stat(join(dir, name));
        if (!s.isFile()) continue;
        files.push({
          name,
          url: `/downloads/v${CURRENT_VERSION}/${encodeURIComponent(name)}`,
          size: s.size,
          ...meta,
        });
      } catch {
        // A file that vanishes mid-listing is skipped, not fatal.
      }
    }
  } catch {
    // Missing directory = nothing published yet; empty list, not an error.
  }

  return Response.json(
    { version: CURRENT_VERSION, files },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
