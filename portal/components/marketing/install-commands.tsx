"use client";

import * as React from "react";
import { ExternalLink, TriangleAlert } from "lucide-react";

import { CodeBlock } from "@/components/docs/code-block";
import { ClaudeLogo } from "@/components/docs/vendor-logos";
import {
  AppleLogo,
  LinuxLogo,
  WindowsLogo,
} from "@/components/marketing/platform-logos";
import { cn } from "@/lib/utils";

/**
 * Installation Commands — the Claude Code CLI install block.
 *
 * Same shape as the code.claude.com install section: one entry per
 * platform, the shell it runs in, the exact one-liner, and the
 * "use code with caution" line under it. Each entry is labelled with
 * the platform logo (Apple / Windows / Linux) as inline SVG, so the
 * block reads at a glance instead of being three walls of text.
 *
 * The commands are Anthropic's own installers — Zaino does not mirror
 * them. What Zaino provides is the endpoint they point at: the
 * ANTHROPIC_BASE_URL wiring lives on /docs.
 */

const COMMANDS: {
  id: string;
  os: string;
  hint: string;
  shell: string;
  command: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "unix",
    os: "macOS / Linux / WSL",
    hint: "Runs in bash — Terminal, iTerm, GNOME Terminal",
    shell: "bash",
    command: "curl -fsSL https://claude.ai/install.sh | bash",
    icon: (
      <span className="flex items-center gap-1">
        <AppleLogo className="size-4" />
        <LinuxLogo className="size-4" />
      </span>
    ),
  },
  {
    id: "powershell",
    os: "Windows PowerShell",
    hint: "Prompt starts with PS C:\\",
    shell: "powershell",
    command: "irm https://claude.ai/install.ps1 | iex",
    icon: <WindowsLogo className="size-4" />,
  },
  {
    id: "cmd",
    os: "Windows CMD",
    hint: "Prompt starts with C:\\",
    shell: "cmd",
    command:
      "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd",
    icon: <WindowsLogo className="size-4" />,
  },
];

export function InstallCommands() {
  return null;
}

function InstallCommandsContent() {
  return (
    <div className="mt-16">
      <div className="mx-auto max-w-2xl text-center">
        <div className="flex justify-center">
          <ClaudeLogo />
        </div>
        <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">
          Installation Commands
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Install Claude Code on your machine
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          Prefer the terminal? One command installs the Claude Code CLI.
          Point it at your Zaino key and you are coding against your own
          gateway.
        </p>
      </div>

      <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {COMMANDS.map((cmd, i) => (
          <div
            key={cmd.id}
            className={cn(
              "p-5 sm:p-6",
              i > 0 &&
                "border-t border-gray-100 dark:border-gray-800",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                {cmd.icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {cmd.os}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {cmd.hint}
                </p>
              </div>
            </div>
            <CodeBlock
              className="mt-4"
              language={cmd.shell}
              filename={cmd.shell}
              code={cmd.command}
            />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              Use code with caution.
            </p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        Full setup guide at{" "}
        <a
          href="https://code.claude.com/docs/en/setup"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-gray-900 underline underline-offset-4 dark:text-gray-100"
        >
          code.claude.com
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
    </div>
  );
}
