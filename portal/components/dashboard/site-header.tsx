"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Command,
  KeyRound,
  Moon,
  Search,
  Sun,
} from "lucide-react";

import { signOutAction } from "@/lib/auth/actions";
import { titleForPath } from "@/components/dashboard/nav";
import { useShellIdentity } from "@/components/dashboard/shell-identity";
import { relativeTime, usd } from "@/lib/dashboard/format";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * SiteHeader — the sticky bar every product page renders under.
 *
 * Layout mirrors the marketing/auth shells' discipline: trigger + title
 * on the start edge, a quiet action cluster on the end edge, and the
 * `min-w-0` rule the shell layout documents (a flex row's min-width is
 * `auto`, so the title must be allowed to truncate rather than push the
 * actions off-canvas at tablet widths).
 *
 * Keyboard: ⌘K / Ctrl-K opens search from anywhere. The dialog keeps
 * focus trapped (Radix) and returns it to the trigger on close.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const { org, role, initials, bundle } = useShellIdentity();

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <SidebarTrigger aria-label="Toggle navigation" />
      <h1 className="truncate text-base font-semibold sm:text-lg">
        {titleForPath(pathname)}
      </h1>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSearchOpen(true)}
          className="hidden items-center gap-2 text-muted-foreground sm:flex"
          aria-label="Search pages and actions"
        >
          <Search />
          <span>Search</span>
          <kbd className="pointer-events-none ml-2 hidden items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline-flex">
            <Command className="size-3" />K
          </kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSearchOpen(true)}
          className="sm:hidden"
          aria-label="Search"
        >
          <Search />
        </Button>

        <AccountStatusMenu />

        <HeaderThemeToggle />

        <HeaderUserMenu onNavigate={() => router.push("/dashboard/settings")} />
      </div>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

function HeaderThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {mounted && dark ? <Moon /> : <Sun />}
    </Button>
  );
}

/**
 * AccountStatusMenu — real account facts, not a notification feed.
 *
 * This was a bell opening three hardcoded notifications ("You've used 2%
 * of included spend", "Entitlements synced", "October invoice available")
 * that were true of nobody in particular. There is no notifications
 * endpoint and none is warranted, so rather than keep a bell that lies,
 * the affordance now reports the account state a customer would otherwise
 * have to go hunting for: which plan, how much spent this period, how many
 * keys, and whether the gateway has the limits it should.
 *
 * The unread dot only appears when something is genuinely off — a failed
 * entitlement sync or a `past_due` subscription — so a dot on the bell
 * means something again.
 */
function AccountStatusMenu() {
  const { bundle } = useShellIdentity();
  const plan = bundle?.plan ?? null;
  const spent = bundle?.usage.costCustomerUsd ?? 0;
  const included = plan ? plan.includedSpendCents / 100 : 0;
  const pct = included > 0 ? Math.round((spent / included) * 100) : 0;

  const problem =
    bundle?.entitlement?.status === "failed" || bundle?.state === "past_due";

  const facts: { label: string; value: string }[] = [
    { label: "Plan", value: plan?.name ?? "None" },
    { label: "Spend this period", value: `${usd(spent)}${included ? ` of $${included.toFixed(2)} (${pct}%)` : ""}` },
    { label: "Active keys", value: `${bundle?.keys.active ?? 0}${bundle?.keys.max ? ` of ${bundle.keys.max}` : ""}` },
    {
      label: "Gateway limits",
      value: bundle?.entitlement?.syncedAt
        ? `synced ${relativeTime(bundle.entitlement.syncedAt)}`
        : "not synced yet",
    },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Account status">
            <span className="relative">
              <Bell />
              {problem ? (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive"
                />
              ) : null}
            </span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Account status</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <dl className="grid gap-2 px-2 py-1.5 text-sm">
          {facts.map((f) => (
            <div key={f.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="text-right font-medium tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
        {problem ? (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs text-destructive">
              {bundle?.entitlement?.status === "failed"
                ? "We could not apply your limits to the gateway. We keep retrying."
                : "A payment failed. Access continues during the grace period."}
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderUserMenu({ onNavigate }: { onNavigate: () => void }) {
  const { org, role, initials } = useShellIdentity();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="ml-1 rounded-full" aria-label="Account menu">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid gap-0.5 font-normal">
            <span className="text-sm font-medium">{org?.name ?? "Account"}</span>
            <span className="text-xs text-muted-foreground">{role ? `Role: ${role}` : ""}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNavigate}>Account settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none select-none hover:bg-destructive/10 focus-visible:ring-2"
          >
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Quick search over the product surface — no backend, just navigation. */
function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const results = React.useMemo(() => {
    const items = [
      { label: "Overview", href: "/dashboard", hint: "Spend, requests, keys" },
      { label: "Usage", href: "/dashboard/usage", hint: "Ledger and charts" },
      { label: "API keys", href: "/dashboard/keys", hint: "Create and revoke" },
      { label: "Billing", href: "/dashboard/billing", hint: "Plan and payments" },
      { label: "Settings", href: "/dashboard/settings", hint: "Account and org" },
    ];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      `${item.label} ${item.hint}`.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>Jump to a page or action.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                onOpenChange(false);
                router.push(results[0].href);
              }
            }}
            placeholder="Search pages…"
            aria-label="Search pages"
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No pages match “{query}”.
            </p>
          ) : (
            results.map((item) => (
              <button
                key={item.href}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  router.push(item.href);
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2"
              >
                <span className="grid flex-1 leading-tight">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <KeyRound className="size-3" />
          Pages only — API keys are managed on the keys page.
        </div>
      </DialogContent>
    </Dialog>
  );
}
