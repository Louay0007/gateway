import { CopyButton } from "@/components/d17/copy-button";
import { formatTndMillimes } from "@/lib/billing/d17-config";
import { t17, type D17Lang } from "@/lib/i18n/d17";
import { Check } from "lucide-react";

/**
 * D17 transfer instructions.
 *
 * WHAT WAS WRONG. The component opened with its own five-node step tracker —
 * `aria-hidden` decoration that duplicated the page's real three-step
 * stepper 200px above it. Below that sat five numbered rows of prose, and the
 * two values a customer must actually type into their banking app (the exact
 * amount and the receiver number) were buried at rows 3 and 4 of 5.
 *
 * On a page whose whole job is "make this transfer", the two values are the
 * content and the five steps are the instruction. So:
 *
 *   1. The values lead, in a two-up panel, set large in mono, each with its
 *      own copy control.
 *   2. The steps follow as a plain ordered list, three of them, because two
 *      of the original five were the values themselves.
 *   3. The decorative tracker is gone. The page's stepper already orients.
 *
 * A typo in the amount or the number produces a transfer nobody can match to
 * a payment, which is the single most common D17 failure — which is why every
 * value here is selectable and copyable.
 */
export function D17Instructions({
  lang,
  amountMillimes,
  receiverPhone,
  reference,
}: {
  lang: D17Lang;
  amountMillimes: number;
  receiverPhone: string;
  reference: string;
}) {
  const t = (key: string, vars?: Record<string, string>) => t17(lang, key, vars);
  const amount = formatTndMillimes(amountMillimes);

  /**
   * Three steps, not five. The originals interleaved the two VALUES with
   * three actions ("open the app", "go to Transfer", "confirm with your PIN,
   * then note the authorisation number"). The values are now a panel above,
   * so the list is only the actions.
   */
  const steps: string[] = [t("d17.step1"), t("d17.step2"), t("d17.step5")];

  return (
    <div className="grid gap-6">
      {/* ── The two values, first ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Value
          label={t("d17.step3")}
          value={amount}
          copyLabel={t("d17.copy")}
          copiedLabel={t("d17.copied")}
        />
        <Value
          label={t("d17.step4")}
          value={receiverPhone}
          copyLabel={t("d17.copy")}
          copiedLabel={t("d17.copied")}
        />
      </div>

      {/* ── Then the actions ─────────────────────────────────────────── */}
      <ol className="grid gap-2.5">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground"
            >
              {i + 1}
            </span>
            <p className="min-w-0 text-sm leading-relaxed text-foreground">
              {step}
            </p>
          </li>
        ))}
      </ol>

      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
        {t("d17.summary_reference")}: <span className="font-mono">{reference}</span>
      </p>
    </div>
  );
}

/**
 * One copyable value.
 *
 * THE VALUE IS ALWAYS INK, never a semantic foreground. This previously
 * carried `text-success-foreground text-success` — two contradictory colour
 * classes. The compiled sheet emits `.text-success-foreground` last, so it
 * won and painted the amount `oklch(0.99 0 0)` — near-white — on a `bg-card`
 * that is pure white in the light theme: 1.03:1. The one number the customer
 * has to retype into a bank app was invisible.
 *
 * The success semantic now lives on the border and the label tick, where it
 * cannot fight the text colour, and the value itself is ink in both themes by
 * construction (19.79:1 on white, 20.36:1 on near-black).
 */
function Value({
  label,
  value,
  copyLabel,
  copiedLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-success/40 bg-success/[0.06] p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        <Check className="size-3 text-success" strokeWidth={3} aria-hidden />
        {label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </code>
        <CopyButton value={value} label={copyLabel} copiedLabel={copiedLabel} />
      </div>
    </div>
  );
}
