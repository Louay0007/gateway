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
    <div className="grid gap-6">
      {/* Visual step tracker */}
      <div className="flex items-center justify-between px-2" aria-hidden="true">
        {steps.map((_, i) => (
          <div key={i} className="flex items-center gap-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-gray-200 bg-white text-xs font-semibold text-gray-600">
              {i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className="h-0.5 w-6 bg-gray-200 sm:w-10 md:w-16" />
            )}
          </div>
        ))}
      </div>

      {/* Detailed steps */}
      <ol className="grid gap-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden
              className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                step.highlight
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-gray-300 bg-white text-gray-600"
              }`}
            >
              {step.highlight ? (
                <Check className="size-3.5" strokeWidth={3} />
              ) : (
                i + 1
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-black">{step.label}</p>
              {step.value ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code
                    className={`min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-sm select-text ${
                      step.highlight
                        ? "border-emerald-200 bg-emerald-50/50 font-semibold text-emerald-900"
                        : "border-gray-200 bg-gray-50 text-black"
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