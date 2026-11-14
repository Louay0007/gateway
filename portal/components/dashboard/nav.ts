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
/**
 * THE CONSOLE'S PRODUCT SURFACE, in the order a customer actually works.
 *
 * WHY THIS ORDER. The previous list was: Chat, Overview, Docs, Usage, Keys,
 * Billing, Redeem, Download. That mixes three different kinds of thing into
 * one flat column — the product (Chat), the console's own pages (Overview,
 * Usage, Keys, Billing), an onboarding step (Redeem), and two marketing
 * pages (Docs, Download). A nav is the map of a product, and a map that
 * mixes a destination with an advertisement of one is not a map.
 *
 * Now it reads as the customer's job, in sequence:
 *
 *   Chat          what you came for
 *   Overview      where am I, how much is left
 *   Usage         what have I actually spent
 *   API keys      what I hand to my code
 *   Billing       what I pay
 *   Docs          how to wire it (in-product, with the keys CTA)
 *
 * `/download` moved to the footer: it is a marketing page, not a console
 * page, and it already has an entry in the public navigation.
 */
export const navMain: NavItem[] = [
  { title: "Chat", href: "/chat", icon: MessageSquare },
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Usage", href: "/dashboard/usage", icon: BarChart3 },
  { title: "API keys", href: "/dashboard/keys", icon: KeyRound },
  { title: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { title: "Docs", href: "/dashboard/docs", icon: BookOpen },
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
/**
 * Account-level and staff destinations.
 *
 * Redeem sits here, not in navMain. It is a one-time onboarding action, not
 * a page a customer returns to — putting it in the primary column gave it
 * the same visual weight as Billing, which is where money actually moves.
 */
export const navSecondary: NavItem[] = [
  // `?tab=profile`, not bare: this entry sits under Overview / Usage /
  // Billing / API keys, so a console user clicking "Settings" means the
  // account, not the plan they were just looking at. The page renders all
  // six tabs either way — this only picks the landing one.
  { title: "Redeem a code", href: "/dashboard/redeem", icon: Gift },
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
