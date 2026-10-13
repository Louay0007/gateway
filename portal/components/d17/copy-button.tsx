"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Copy a value the customer must transfer exactly.
 *
 * The amount and the receiver number are the two fields a mistyped D17
 * transfer ruins, and both are long enough to mistype. Copy removes the
 * transcription step entirely, which is the whole reason the D17 page
 * exists rather than an email.
 *
 * `navigator.clipboard` needs a secure context. Over plain HTTP on a LAN
 * address it is undefined, so the fallback selects the text instead of
 * throwing — a dead button is worse than a select-all.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  className,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // No clipboard permission (insecure context): select the text so
        // the customer can copy it with the keyboard.
        const el = document.createElement("textarea");
        el.value = value;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className={cn("shrink-0", className)}
      aria-label={copied ? copiedLabel : label}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? copiedLabel : label}
    </Button>
  );
}