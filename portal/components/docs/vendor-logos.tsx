import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * VendorLogo — official vendor artwork, self-hosted.
 *
 * Sourced from Wikimedia Commons (public-domain textlogo files,
 * trademark of their respective owners, used here nominatively to
 * label compatibility — "OpenAI-compatible", "Anthropic-compatible"):
 *
 *   OpenAI blossom (2025 symbol) … /logos/openai-blossom.svg
 *   Anthropic wordmark ……………… /logos/anthropic.svg
 *   Claude starburst + wordmark …… /logos/claude.svg
 *
 * Attribution lives in public/logos/ATTRIBUTION.md. Files are local —
 * no hotlink, no CDN dependency, no layout shift (fixed tile size).
 *
 * Codex has no separate official logo: the CLI ships under the OpenAI
 * brand, so the Codex card reuses the blossom with a "CLI" caption.
 */

function Tile({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white dark:bg-gray-900 p-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function OpenAILogo({ className }: { className?: string }) {
  return (
    <Tile className={className}>
      <Image
        src="/logos/openai-blossom.svg"
        alt="OpenAI logo"
        width={40}
        height={40}
        className="size-10 object-contain"
      />
    </Tile>
  );
}

export function AnthropicLogo({ className }: { className?: string }) {
  return (
    <Tile className={className}>
      <Image
        src="/logos/anthropic.svg"
        alt="Anthropic logo"
        width={40}
        height={12}
        className="h-3 w-10 object-contain"
      />
    </Tile>
  );
}

export function ClaudeLogo({ className }: { className?: string }) {
  return (
    <Tile className={className}>
      <Image
        src="/logos/claude-icon.svg"
        alt="Claude logo"
        width={44}
        height={44}
        className="size-11 object-contain"
      />
    </Tile>
  );
}
