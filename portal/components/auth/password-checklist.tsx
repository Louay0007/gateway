"use client";

import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PasswordChecklist — live strong-password details for account creation.
 *
 * Mirrors validatePassword() in lib/auth/password.ts exactly:
 *   1. at least 12 characters
 *   2. two of: lowercase, uppercase, numbers, symbols
 *   3. no long run of one repeated character
 * The banned-common-password list is NOT duplicated here — a client copy
 * would drift from the server's, and the server answer is authoritative
 * (it re-validates on submit and returns the field error).
 *
 * UX: quiet checklist that lights up green as the user types —
 * `aria-describedby="password-hint"` on the input means screen readers
 * read the whole list when the field takes focus (no per-item live
 * announcements, which would be chatter).
 */
function longestRun(s: string): number {
  let best = 0;
  let cur = 0;
  let prev = "";
  for (const ch of s) {
    cur = ch === prev ? cur + 1 : 1;
    prev = ch;
    if (cur > best) best = cur;
  }
  return best;
}

export function PasswordChecklist({ password }: { password: string }) {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;

  const checks = [
    { ok: password.length >= 12, label: "At least 12 characters" },
    { ok: classes >= 2, label: "Two of: lowercase, uppercase, numbers, symbols" },
    { ok: longestRun(password) < 6, label: "No long runs of the same character" },
  ];

  return (
    <ul id="password-hint" className="mt-2 space-y-1">
      {checks.map((check) => (
        <li
          key={check.label}
          className={cn(
            "flex items-center gap-2 text-xs transition-colors duration-150 motion-reduce:transition-none",
            // Theme-aware: the fixed `text-emerald-700` / `text-gray-500`
            // pair this started with was tuned for a white card only. On the
            // dark dashboard surface they measured 3.34:1 and 3.7:1 — the
            // color-contrast failures Lighthouse found on /dashboard/settings
            // in dark mode. emerald-400 on dark and the muted-foreground token
            // both clear 4.5:1 in either theme.
            check.ok
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground",
          )}
        >
          {check.ok ? (
            <Check className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <Circle className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
          )}
          {check.label}
        </li>
      ))}
    </ul>
  );
}