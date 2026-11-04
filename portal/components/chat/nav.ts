import { Download, KeyRound, Settings, ShieldCheck, type LucideIcon } from "lucide-react";

/** One secondary nav entry in the chat shell. */
export type ChatNavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  staffOnly?: boolean;
};

/**
 * The chat shell's secondary navigation.
 *
 * Deliberately short. The conversation list is the primary navigation now;
 * everything else is a destination you leave chat for, and there are only
 * four of them. "Usage" and "plan" are not listed separately because they
 * are tabs of one settings page — listing them twice is how a product grows
 * two mental models of the same screen.
 */
export const chatNav: ChatNavItem[] = [
  { title: "Settings", href: "/settings", icon: Settings },
  { title: "API keys", href: "/settings?tab=keys", icon: KeyRound },
  { title: "Download", href: "/download", icon: Download },
  { title: "Operations", href: "/admin", icon: ShieldCheck, staffOnly: true },
];
