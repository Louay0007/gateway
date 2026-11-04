import {
  BarChart3,
  BookOpen,
  CreditCard,
  Download,
  Gift,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
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
  // First, because chat is the product and this shell is the console
  // around it. Without this entry the only route back to /chat was the
  // landing page: a signed-in customer who opened /dashboard had no way
  // in except typing the URL.
  { title: "Chat", href: "/chat", icon: MessageSquare },
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Docs", href: "/dashboard/docs", icon: BookOpen },
  { title: "Usage", href: "/dashboard/usage", icon: BarChart3 },
  { title: "API keys", href: "/dashboard/keys", icon: KeyRound },
  { title: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { title: "Redeem", href: "/dashboard/redeem", icon: Gift },
{ title: "Download", href: "/download", icon: Download },
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
  // `?tab=profile`, not bare: this entry sits under Overview / Usage /
  // Billing / API keys, so a console user clicking "Settings" means the
  // account, not the plan they were just looking at. The page renders all
  // six tabs either way — this only picks the landing one.
  { title: "Settings", href: "/dashboard/settings?tab=profile", icon: Settings },
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
  // An entry may carry a query to pick a landing tab
  // (`/dashboard/settings?tab=profile`). `usePathname()` never returns a
  // query, so matching the raw href found nothing and every such page
  // titled itself "Dashboard".
  const path = (href: string) => href.split("?")[0];
  const match =
    all.find((item) => pathname === path(item.href)) ??
    all.find((item) => pathname.startsWith(`${path(item.href)}/`));
  return match?.title ?? "Dashboard";
}
