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
    colorClass: 'text-warning',
    bgClass: 'bg-warning/10',
    borderClass: 'border-warning/30',
    titleKey: 'd17.status_pending',
    explainKey: 'd17.state_pending_explain',
    pulse: true,
  },
  proof_submitted: {
    icon: Loader2,
    colorClass: 'text-warning',
    bgClass: 'bg-warning/10',
    borderClass: 'border-warning/30',
    titleKey: 'd17.status_submitted',
    explainKey: 'd17.state_submitted_explain',
    pulse: true,
  },
  paid: {
    icon: CheckCircle2,
    colorClass: 'text-success',
    bgClass: 'bg-success/10',
    borderClass: 'border-success/30',
    titleKey: 'd17.status_paid',
    explainKey: 'd17.state_paid_explain',
    pulse: false,
  },
  rejected: {
    icon: XCircle,
    colorClass: 'text-destructive',
    bgClass: 'bg-destructive/10',
    borderClass: 'border-destructive/30',
    titleKey: 'd17.status_rejected',
    explainKey: 'd17.state_rejected_explain',
    pulse: false,
  },
  expired: {
    icon: AlertTriangle,
    colorClass: 'text-destructive',
    bgClass: 'bg-destructive/10',
    borderClass: 'border-destructive/30',
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
      className={`rounded-xl border ${config.borderClass} ${config.bgClass} px-5 py-4 shadow-sm ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3.5">
        <div className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/60 dark:bg-primary/60`}>
          <Icon
            className={`size-4.5 ${config.colorClass} ${ config.pulse ? 'd17-status-pulse' : '' }`}
            aria-hidden="true"
          />
        </div>
        <div className="grid gap-1.5">
          <p className={`text-sm font-semibold leading-tight ${config.colorClass}`}>
            {t(config.titleKey)}
          </p>
          <p className="text-sm leading-relaxed text-foreground">{t(config.explainKey)}</p>
          {status === 'rejected' && rejectReason && (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-destructive/30 border-destructive/40 bg-white px-2.5 py-1.5 text-xs font-medium text-destructive text-destructive">
              {t('d17.rejected_banner', { reason: rejectReason })}
            </p>
          )}
          {status === 'proof_submitted' && flaggedReview && (
            <p className="mt-0.5 text-xs font-medium text-warning">{t('d17.waiting_review')}</p>
          )}
        </div>
      </div>
    </div>
  );
}