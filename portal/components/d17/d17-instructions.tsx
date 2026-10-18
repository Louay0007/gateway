import { CopyButton } from "@/components/d17/copy-button";
import { formatTndMillimes } from "@/lib/billing/d17-config";
import { t17, type D17Lang } from "@/lib/i18n/d17";
import { Check } from "lucide-react";

/**
 * D17 transfer instructions with visual step tracker.
 *
 * Each step is one action in the D17 banking app. The amount and receiver
 * number are copyable because a typo in either produces a transfer nobody
 * can match to a payment — the single most common failure mode.
 *
 * The visual stepper (numbered circles with connector lines) gives users
 * orientation in what is otherwise a wall of text. Completed-style styling
 * is not used here because these are instructions, not progress indicators;
 * the stepper on the checkout page tracks actual flow state.
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

  const steps: { label: string; value?: string; copyable?: boolean; highlight?: boolean }[] = [
    { label: t("d17.step1") },
    { label: t("d17.step2") },
    { label: t("d17.step3"), value: amount, copyable: true, highlight: true },
    { label: t("d17.step4"), value: receiverPhone, copyable: true, highlight: true },
    { label: t("d17.step5") },
  ];

  return (
    <div className="grid gap-5">
      {/* Visual step tracker — decorative only, detailed list carries semantics */}
      <div className="flex items-center justify-between px-1" aria-hidden="true">
        {steps.map((_, i) => (
          <div key={i} className="flex items-center">
            <div className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors ${
              steps[i].highlight
                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                : "border-gray-200 bg-white text-gray-500"
            }`}>
              {i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px w-5 sm:w-8 md:w-12 ${
                steps[i].highlight ? "bg-emerald-300" : "bg-gray-200"
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Detailed steps */}
      <ol className="grid gap-3">
        {steps.map((step, i) => (
          <li key={i} className={`flex gap-3.5 rounded-lg p-2.5 transition-colors ${
            step.highlight ? "bg-emerald-50/30" : ""
          }`}>
            <span
              aria-hidden
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                step.highlight
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {step.highlight ? (
                <Check className="size-3.5" strokeWidth={3} />
              ) : (
                i + 1
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm leading-relaxed ${
                step.highlight ? "font-medium text-gray-900" : "text-gray-700"
              }`}>{step.label}</p>
              {step.value ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code
                    className={`min-w-0 flex-1 select-all rounded-lg border px-3 py-2.5 font-mono text-sm tabular-nums tracking-tight ${
                      step.highlight
                        ? "border-emerald-200 bg-white text-base font-semibold text-emerald-900 shadow-sm"
                        : "border-gray-200 bg-gray-50/80 text-gray-900"
                    }`}
                  >
                    {step.value}
                  </code>
                  {step.copyable ? (
                    <CopyButton
                      value={step.value}
                      label={t("d17.copy")}
                      copiedLabel={t("d17.copied")}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}

        <li className="sr-only" aria-hidden>
          {t("d17.summary_reference")}: {reference}
        </li>
      </ol>
    </div>
  );
}