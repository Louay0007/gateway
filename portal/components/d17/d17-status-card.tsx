/**
 * D17StatusCard — reusable status display for the subscription flow.
 *
 * Renders a colored card with icon, title, and explanation text based on
 * the payment status. Used by both the D17 checkout page and the billing
 * dashboard to give users clear visual feedback about where they are in
 * the manual payment process.
 *
 * Color system:
 *   emerald  → paid / active
 *   amber    → pending_payment / proof_submitted (with pulse animation)
 *   red      → rejected / expired
 *   slate    → unknown / fallback
 */

import { CheckCircle2, Clock, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import type { D17Lang } from '@/lib/i18n/d17';
import { t17 } from '@/lib/i18n/d17';

export type D17PaymentStatus =
  | 'pending_payment'
  | 'proof_submitted'
  | 'paid'
  | 'rejected'
  | 'expired';

interface D17StatusCardProps {
  status: D17PaymentStatus;
  lang: D17Lang;
  rejectReason?: string | null;
  flaggedReview?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<
  D17PaymentStatus,
  {
    icon: typeof CheckCircle2;
    colorClass: string;
    bgClass: string;
    borderClass: string;
    titleKey: string;
    explainKey: string;
    pulse: boolean;
  }
> = {
  pending_payment: {
    icon: Clock,
    colorClass: 'text-amber-700',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
    titleKey: 'd17.status_pending',
    explainKey: 'd17.state_pending_explain',
    pulse: true,
  },
  proof_submitted: {
    icon: Loader2,
    colorClass: 'text-amber-700',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
    titleKey: 'd17.status_submitted',
    explainKey: 'd17.state_submitted_explain',
    pulse: true,
  },
  paid: {
    icon: CheckCircle2,
    colorClass: 'text-emerald-700',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
    titleKey: 'd17.status_paid',
    explainKey: 'd17.state_paid_explain',
    pulse: false,
  },
  rejected: {
    icon: XCircle,
    colorClass: 'text-red-700',
    bgClass: 'bg-red-50',
    borderClass: 'border-red-200',
    titleKey: 'd17.status_rejected',
    explainKey: 'd17.state_rejected_explain',
    pulse: false,
  },
  expired: {
    icon: AlertTriangle,
    colorClass: 'text-red-700',
    bgClass: 'bg-red-50',
    borderClass: 'border-red-200',
    titleKey: 'd17.status_expired',
    explainKey: 'd17.state_expired_explain',
    pulse: false,
  },
};

export function D17StatusCard({
  status,
  lang,
  rejectReason,
  flaggedReview,
  className = '',
}: D17StatusCardProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending_payment;
  const Icon = config.icon;
  const t = (key: string, vars?: Record<string, string>) => t17(lang, key, vars);

  return (
    <div
      className={`rounded-xl border ${config.borderClass} ${config.bgClass} p-4 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <Icon
          className={`mt-0.5 h-5 w-5 shrink-0 ${config.colorClass} ${
            config.pulse ? 'd17-status-pulse' : ''
          }`}
          aria-hidden="true"
        />
        <div className="grid gap-1">
          <p className={`text-sm font-semibold ${config.colorClass}`}>
            {t(config.titleKey)}
          </p>
          <p className="text-sm text-gray-700">{t(config.explainKey)}</p>
          {status === 'rejected' && rejectReason && (
            <p className="mt-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-700">
              {t('d17.rejected_banner', { reason: rejectReason })}
            </p>
          )}
          {status === 'proof_submitted' && flaggedReview && (
            <p className="mt-1 text-xs text-amber-800">{t('d17.waiting_review')}</p>
          )}
        </div>
      </div>
    </div>
  );
}