import {
  BarChart3,
  BookOpen,
  CreditCard,
  Gift,
  KeyRound,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

/** One nav entry. `staffOnly` items render for staff sessions only. */
export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  staffOnly?: boolean;
};

/** The product surface — the customer's whole job list. */
export const navMain: NavItem[] = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Docs", href: "/dashboard/docs", icon: BookOpen },
  { title: "Usage", href: "/dashboard/usage", icon: BarChart3 },
  { title: "API keys", href: "/dashboard/keys", icon: KeyRound },
  { title: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { title: "Redeem", href: "/dashboard/redeem", icon: Gift },
];

/**
 * Account-level and staff-only destinations.
 *
 * ONE staff entry, not two. The console used to offer "Admin" and "D17
 * queue" as separate sidebar links; it now has its own navigation (the
 * operations shell), so a single "Operations" entry is the honest
 * representation. Listing the queue separately would imply it lives
 * somewhere other than the console.
 */
export const navSecondary: NavItem[] = [
  { title: "Settings", href: "/dashboard/settings", icon: Settings },
  {
    title: "Operations",
    href: "/admin",
    icon: ShieldCheck,
    staffOnly: true,
  },
];

/** Pathname → the header's page title. Falls back to the nav match. */
export function titleForPath(pathname: string): string {
  const all = [...navMain, ...navSecondary];
  const match = all.find((item) => pathname === item.href)
    ?? all.find((item) => pathname.startsWith(`${item.href}/`));
  return match?.title ?? "Dashboard";
}
