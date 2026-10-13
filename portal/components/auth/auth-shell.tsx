import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import Logo from "@/assets/logo/logo";

/**
 * AuthShell — the single layout for every auth page.
 *
 * One centered card, nothing else: no marketing nav, no footer, no side
 * panel. Auth is a task, not a pitch — the visitor is here to sign in,
 * so the page gets out of the way. The canvas is fixed WHITE (not the
 * bg-background token) in both themes: auth pages are always the light,
 * calm surface, even when the signed-in app runs dark.
 *
 * Pro polish (ui-ux-pro-max rulebook):
 * - Entrance is the app's own `animate-hero-rise` (CSS, no JS): runs with
 *   JS disabled, `both` holds the end state, no empty-hero failure mode.
 * - Focus is never removed: the logo link keeps a visible ring.
 * - `aria-labelledby` names the region for screen readers.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  className,
  titleId = "auth-title",
}: {
  title: string;
  /**
   * Optional: several states legitimately have nothing to add — a payment
   * already active, a subscription not found, a dev simulator that is
   * simply disabled. Forcing a filler sentence there is worse than saying
   * nothing. Also used by the payment pages (billing/confirm,
   * checkout/d17), which share this shell rather than duplicating it.
   */
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <main className="light-surface flex min-h-dvh items-center justify-center bg-white px-4 py-12">
      <div
        aria-labelledby={titleId}
        className={cn("animate-hero-rise w-full max-w-sm", className)}
      >
        <Link
          href="/"
          aria-label="Zaino AI home"
          className="mb-8 flex justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
        >
          <Logo tone="light" />
        </Link>
        <h1
          id={titleId}
          className="text-center text-2xl font-semibold tracking-tight text-black"
        >
          {title}
        </h1>
        <div className="mt-2 text-center text-sm text-gray-600">{subtitle}</div>
        <div className="mt-8">{children}</div>
        {footer ? (
          <p className="mt-6 text-center text-sm text-gray-600">{footer}</p>
        ) : null}
      </div>
    </main>
  );
}
