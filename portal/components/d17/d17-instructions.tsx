import { CopyButton } from "@/components/d17/copy-button";
import { formatTndMillimes } from "@/lib/billing/d17-config";
import { t17, type D17Lang } from "@/lib/i18n/d17";

/**
 * The D17 transfer instructions.
 *
 * Rendered as numbered steps rather than prose because it is a procedure
 * the customer follows inside a banking app while holding this page. Each
 * step is one action in that app.
 *
 * The amount and the receiver number are the two values a typo ruins, and
 * both are copyable — a mistyped amount produces a transfer nobody can
 * match to a payment, which is the single most common failure of a manual
 * payment method.
 *
 * `lang` is threaded through rather than read from context: the page owns
 * the `?lang=` resolution, and this component stays a pure function of
 * its props.
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

  const steps: { label: string; value?: string; copyable?: boolean }[] = [
    { label: t("d17.step1") },
    { label: t("d17.step2") },
    { label: t("d17.step3"), value: amount, copyable: true },
    { label: t("d17.step4"), value: receiverPhone, copyable: true },
    { label: t("d17.step5") },
  ];

  return (
    <ol className="grid gap-4">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs font-medium text-gray-700"
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug text-black">{step.label}</p>
            {step.value ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-black select-text">
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
  );
}