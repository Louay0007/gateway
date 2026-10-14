import {
  BarChart3,
  CreditCard,
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
  { title: "Usage", href: "/dashboard/usage", icon: BarChart3 },
  { title: "API keys", href: "/dashboard/keys", icon: KeyRound },
  { title: "Billing", href: "/dashboard/billing", icon: CreditCard },
];

/** Account-level and staff-only destinations. */
export const navSecondary: NavItem[] = [
  { title: "Settings", href: "/dashboard/settings", icon: Settings },
  {
    title: "Admin",
    href: "/admin",
    icon: ShieldCheck,
    staffOnly: true,
  },
  {
    title: "D17 queue",
    href: "/admin/d17",
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
