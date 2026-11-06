"use client";
import { useEffect, useRef, useState } from "react";
import Logo from "@/assets/logo/logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { MaintenanceBanner } from "@/components/marketing/maintenance-banner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronRight, Equal, X } from "lucide-react";

const navLinks = [
  { title: "Download", href: "/download" },
  { title: "Docs", href: "/docs" },
  { title: "Changelog", href: "/changelog" },
  { title: "Sign in", href: "/sign-in" },
];

const Navbar = ({
  active,
  tone,
  banner,
  signedIn = false,
  name = null,
  image = null,
  initials = null,
}: {
  tone?: "dark" | "light";
  active?: string;
  /** Optional notice strip rendered under the nav row (maintenance, alerts). */
  banner?: string;
  /**
   * Resolved on the server by components/marketing/site-nav.tsx. The
   * signed-in branch replaces "Sign in / Get an API key" with the account
   * avatar and one clear way into the product; the signed-out branch is
   * unchanged.
   */
  signedIn?: boolean;
  name?: string | null;
  image?: string | null;
  initials?: string | null;
}) => {
  const navRef = useRef<HTMLElement>(null);
  const isLanding = tone === "light";
  const [isDarkTheme, setIsDarkTheme] = useState(false);
  // "Sign in" is a link to a page a signed-in visitor is redirected away
  // from — it would bounce them into /chat, which the right-hand button
  // already does on purpose.
  const visibleLinks = signedIn
    ? navLinks.filter((l) => l.href !== "/sign-in")
    : navLinks;

  useEffect(() => {
    // Detect current dark mode state and watch for changes
    const checkDark = () => setIsDarkTheme(document.documentElement.classList.contains("dark"));
    checkDark();

    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const wordmark = nav.querySelector<HTMLElement>("[data-wordmark]");
    const sep = nav.querySelector<HTMLElement>("[data-sep]");
    const links = nav.querySelectorAll<HTMLElement>("[data-navlink]");
    const signinRight = nav.querySelector<HTMLElement>("[data-signin-right]");

    const applyColors = () => {
      // Home landing only (tone="light"): black glass throughout. The old
      // orange tint matched the Halloween hero artwork, which is gone; the
      // hero is now a violet glow on near-black, so a dark navbar already
      // sits on it and no scroll state is needed.
      if (isLanding) {
        nav.style.background = "";
        nav.style.backgroundColor = "rgba(0, 0, 0, 0.55)";
        nav.style.backdropFilter = "blur(16px)";
        (nav.style as any).webkitBackdropFilter = "blur(16px)";
        nav.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

        if (wordmark) wordmark.style.color = "#ffffff";
        if (sep) sep.style.backgroundColor = "rgba(255,255,255,0.2)";
        if (signinRight) signinRight.style.color = "#ffffff";

        links.forEach((link) => {
          link.style.color = "rgba(255,255,255,0.7)";
          link.style.backgroundColor = "transparent";
        });
        return;
      }

      // All pages other than the home landing: permanent black glass with
      // white text — no scroll states, no theme dependency.
      nav.style.background = "";
      nav.style.backgroundColor = "rgba(0, 0, 0, 0.85)";
      nav.style.backdropFilter = "blur(16px)";
      (nav.style as any).webkitBackdropFilter = "blur(16px)";
      nav.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

      nav.style.color = "#ffffff";
      if (wordmark) wordmark.style.color = "#ffffff";
      if (sep) sep.style.backgroundColor = "rgba(255,255,255,0.2)";
      if (signinRight) signinRight.style.color = "#ffffff";

      links.forEach((link) => {
        link.style.color = "rgba(255,255,255,0.7)";
        link.style.backgroundColor = "transparent";
      });
    };

    // Apply immediately
    applyColors();

    // Poll aggressively for first 2 seconds to catch any late scroll position
    let pollCount = 0;
    const pollInterval = setInterval(() => {
      applyColors();
      pollCount++;
      if (pollCount > 40) clearInterval(pollInterval);
    }, 50);

    // Also listen to scroll events
    const onScroll = () => applyColors();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [active, isLanding]);

  return (
    <nav
      ref={navRef}
      className="fixed inset-x-0 top-0 z-50 w-full transition-all duration-300"
      style={{ backgroundColor: "transparent" }}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8 xl:px-16">
        <div className="flex items-center gap-4 lg:gap-6">
          <a href="/" className="shrink-0">
            <span className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-900 dark:bg-gray-700 dark:ring-1 dark:ring-white/20">
                <img
                  src="/logo/zaino-curved-z-white.png"
                  alt="Zaino AI logo"
                  width={28}
                  height={28}
                  className="size-7 object-contain"
                />
              </span>
              <span
                data-wordmark=""
                className="text-lg font-semibold tracking-tight transition-colors duration-300"
              >
                Zaino AI
              </span>
            </span>
          </a>
          <Separator
            orientation="vertical"
            data-sep=""
            className="hidden h-6 my-auto lg:block transition-colors duration-300"
          />
          <div className="hidden items-center gap-1 lg:flex">
            {visibleLinks.map((link) => (
              <a
                key={link.title}
                href={link.href}
                data-navlink={link.title}
                className="rounded-full px-3 py-1.5 text-base font-medium whitespace-nowrap transition-colors duration-300"
              >
                {link.title}
              </a>
            ))}
          </div>
        </div>
        <div className="hidden items-center gap-4 lg:flex">
          {signedIn ? (
            <>
              <a
                href="/chat"
                data-signin-right=""
                className="whitespace-nowrap text-base font-medium transition-colors duration-300"
              >
                Open chat
                <ChevronRight className="ml-1 inline-block size-4 align-[-2px]" />
              </a>
              <a
                href="/dashboard/settings"
                aria-label={name ? `${name} — account settings` : "Account settings"}
                title={name ?? "Account"}
                className="shrink-0 rounded-full ring-offset-2 ring-offset-transparent transition hover:ring-2 hover:ring-current/40 focus-visible:ring-2 focus-visible:ring-current/60 focus-visible:outline-none"
              >
                <Avatar className="size-9">
                  {image ? <AvatarImage src={image} alt={name ?? "Account"} /> : null}
                  <AvatarFallback className="bg-gray-900/80 text-sm font-medium text-white dark:bg-white/15">
                    {initials ?? "…"}
                  </AvatarFallback>
                </Avatar>
              </a>
            </>
          ) : (
            <>
              <Button
                render={<a href="/sign-up" />}
                nativeButton={false}
                className="group h-10 rounded-full px-5 font-medium hover:bg-primary/80 cursor-pointer"
              >
                Get an API key
                <ChevronRight className="size-4 transition-all group-hover:translate-x-0.5 duration-300" />
              </Button>
            </>
          )}
        </div>
        <Sheet>
          <SheetTrigger
            render={
              <Button
                size="icon"
                className="h-10 w-10 rounded-full lg:hidden hover:bg-primary/80 cursor-pointer"
              >
                <Equal className="size-4" />
                <span className="sr-only">Menu</span>
              </Button>
            }
          />
          <SheetContent
            side="right"
            showCloseButton={false}
            className="flex flex-col gap-6 overflow-auto border-l border-border bg-background p-4 sm:p-6 no-scrollbar"
          >
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <SheetHeader className="flex-row items-center justify-between p-0">
              <SheetClose nativeButton={false} render={
                <a href="#">
                  <Logo />
                </a>
              } />
              <SheetClose className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-primary hover:text-primary-foreground cursor-pointer">
                <X size={16} className="shrink-0" />
              </SheetClose>
            </SheetHeader>
            <div className="flex flex-col gap-1.5">
              {visibleLinks.map((link) => (
                <SheetClose
                  key={link.title}
                  nativeButton={false}
                  render={
                    <a
                      href={link.href}
                      className={cn(
                        "rounded-lg px-3 py-2 text-base font-normal hover:bg-primary/10",
                        "text-muted-foreground",
                      )}
                    >
                      {link.title}
                    </a>
                  }
                />
              ))}
            </div>
            <div className="mt-auto flex flex-col gap-3">
              {signedIn ? (
                <>
                  <div className="flex items-center gap-3 px-1">
                    <Avatar className="size-9 shrink-0">
                      {image ? <AvatarImage src={image} alt={name ?? "Account"} /> : null}
                      <AvatarFallback className="text-sm font-medium">
                        {initials ?? "…"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm font-medium text-foreground">
                      {name ?? "Signed in"}
                    </span>
                  </div>
                  <SheetClose
                    render={
                      <Button
                        render={<a href="/chat" />}
                        nativeButton={false}
                        className="group h-10 w-full rounded-full px-5 font-medium hover:bg-primary/80 cursor-pointer"
                      >
                        Open chat
                        <ChevronRight className="size-4 transition-all group-hover:translate-x-0.5 duration-300" />
                      </Button>
                    }
                  />
                  <SheetClose
                    nativeButton={false}
                    render={
                      <a
                        href="/dashboard/settings"
                        className="px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Account settings
                      </a>
                    }
                  />
                </>
              ) : (
                <>
                  <SheetClose
                    nativeButton={false}
                    render={
                      <a href="/sign-in" className="transition-colors text-foreground">
                        Sign in
                      </a>
                    }
                  />
                  <SheetClose
                    render={
                      <Button
                        render={<a href="/sign-up" />}
                        nativeButton={false}
                        className="group h-10 w-full rounded-full px-5 font-medium hover:bg-primary/80 cursor-pointer"
                      >
                        Get an API key
                        <ChevronRight className="size-4 transition-all group-hover:translate-x-0.5 duration-300" />
                      </Button>
                    }
                  />
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {banner ? <MaintenanceBanner message={banner} /> : null}
    </nav>
  );
};

export default Navbar;