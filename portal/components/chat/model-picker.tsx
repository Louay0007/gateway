"use client";

import Image from "next/image";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { aliasMeta } from "@/components/chat/aliases";
import { Button } from "@/components/ui/button";

export interface ModelOption {
  alias: string;
  /** Blended tokens left this period. Undefined = unlimited. */
  remainingTokens?: number;
  /** Budget for this alias, raw blended tokens. 0/undefined = unlimited. */
  tokenLimit?: number;
}

/**
 * The Zaino mark, used as the tier glyph.
 *
 * Replaces the three-bar ladder. The bars encoded the tier ORDER, but at
 * 12px they read as a signal-strength meter — a meaning nobody intended,
 * and one that says "your connection is weak" next to the model name. The
 * product's own mark says "this is Zaino's model", which is the true
 * statement, and the label beside it already carries the tier.
 *
 * `brightness-0` renders the supplied white-on-transparent PNG as a solid
 * mark on a light background; `dark:brightness-100` leaves it white in dark
 * mode. One asset therefore serves both themes without a second file.
 */
function ZainoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo/zaino-curved-z-white.png"
      alt=""
      aria-hidden
      width={14}
      height={14}
      className={cn("shrink-0 dark:brightness-100 brightness-0", className)}
    />
  );
}

/**
 * ModelPicker — one dropdown, aliases only, exhaustion visible.
 *
 * The list is whatever `getAllowedModels()` returned, passed down from the
 * server. Two consequences that are deliberate:
 *
 *   - AN ALIAS IN THE LIST IS NOT NECESSARILY USABLE. `getAllowedModels`
 *     removes an alias the instant its token budget is spent, so the
 *     absence is the signal, not a number we colour red. The picker shows
 *     spent aliases greyed with "out of tokens this period" instead of
 *     dropping them, because an alias that silently vanishes reads as a
 *     bug and produces a support ticket.
 *   - NO ALIAS IS INVENTED. An empty list means no plan, and the caller
 *     renders the paywall sentence, not a picker with a default model
 *     that the server will reject.
 *
 * The trigger shows the Zaino mark, the alias, and nothing else. The menu
 * adds the "provided by" tier line, which is provenance for the alias — not
 * a read of the upstream model id (see components/chat/aliases.ts).
 */
export function ModelPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: ModelOption[];
  value: string | null;
  onChange: (alias: string) => void;
  disabled?: boolean;
}) {
  const current = value ?? options[0]?.alias ?? null;
  const meta = current ? aliasMeta(current) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || options.length === 0}
            className="px-1.5 text-xs font-medium text-muted-foreground"
            aria-label={meta ? `Model: ${meta.label}. Change model` : "Choose a model"}
          >
            {current ? <ZainoMark /> : null}
            <span className="text-foreground">{meta?.label ?? "No model"}</span>
            <ChevronDown className="size-3 opacity-60" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="start" side="top" className="w-72">
        {/*
          THE LABEL MUST SIT INSIDE A Group.

          `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, which reads
          `MenuGroupRootContext` on mount and throws when there is no
          `<Menu.Group>` ancestor. In production that surfaced as

            Uncaught Error: Base UI error #31

          the moment the picker was opened — the whole page then fell to
          the error boundary, which is why it looked like "the model
          switch broke the chat".
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-1.5 pt-1 pb-1.5 text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
            Model
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <DropdownMenuItem disabled>No models on your plan yet</DropdownMenuItem>
        ) : (
          options.map((option) => {
            const m = aliasMeta(option.alias);
            const spent = isExhausted(option);
            const active = option.alias === current;
            return (
              <DropdownMenuItem
                key={option.alias}
                onClick={() => !spent && onChange(option.alias)}
                disabled={spent}
                className={cn(
                  "flex items-start gap-2.5 py-2",
                  spent && "opacity-50",
                )}
              >
                <ZainoMark className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    {m.label}
                    {active ? (
                      <Check className="size-3 text-muted-foreground" aria-label="Current" />
                    ) : null}
                  </span>
                  {/* "provided by" — the Zaino tier serving this alias.
                      Deliberately not the upstream model id: the alias is a
                      promise that survives a model swap. */}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/80">
                    {m.provider}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {spent ? "Out of tokens — resets at plan renewal" : m.blurb}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A budget of 0 is UNLIMITED, not spent — `computeTokenAllowedModels`
 * treats a missing/zero limit that way (quota.ts), and reversing it here
 * would grey out every alias on an unlimited plan.
 *
 * 0039: the options now carry the plan's SHARED pool rather than a
 * per-alias allowance, so this returns the same answer for every alias —
 * which is correct: when the pool is spent, no model can serve.
 */
function isExhausted(o: ModelOption): boolean {
  if (o.tokenLimit === undefined || o.tokenLimit <= 0) return false;
  return (o.remainingTokens ?? 0) <= 0;
}
