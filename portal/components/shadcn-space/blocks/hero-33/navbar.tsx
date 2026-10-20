"use client";
import { useEffect, useRef } from "react";
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
}: {
  tone?: "dark" | "light";
  active?: string;
}) => {
  const navRef = useRef<HTMLElement>(null);
  const forceLight = tone === "light";

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const wordmark = nav.querySelector<HTMLElement>("[data-wordmark]");
    const sep = nav.querySelector<HTMLElement>("[data-sep]");
    const links = nav.querySelectorAll<HTMLElement>("[data-navlink]");
    const signinRight = nav.querySelector<HTMLElement>("[data-signin-right]");

    const applyColors = (scrolled: boolean) => {
      const isDark = forceLight || scrolled;
      const textColor = isDark ? "#000000" : "#ffffff";
      const mutedColor = isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)";
      const sepColor = isDark ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.2)";

      nav.style.backgroundColor = isDark ? "rgba(255,255,255,0.92)" : "transparent";
      nav.style.backdropFilter = isDark ? "blur(16px)" : "none";
      (nav.style as any).webkitBackdropFilter = isDark ? "blur(16px)" : "none";
      nav.style.borderBottom = isDark ? "1px solid rgba(0,0,0,0.06)" : "none";

      if (wordmark) wordmark.style.color = textColor;
      if (sep) sep.style.backgroundColor = sepColor;
      if (signinRight) signinRight.style.color = textColor;

      links.forEach((link) => {
        link.style.color = mutedColor;
        link.style.backgroundColor = "transparent";
      });
    };

    // Apply immediately
    applyColors(forceLight || window.scrollY > 80);

    // Poll aggressively for first 2 seconds to catch any late scroll position
    let pollCount = 0;
    const pollInterval = setInterval(() => {
      applyColors(forceLight || window.scrollY > 80);
      pollCount++;
      if (pollCount > 40) clearInterval(pollInterval);
    }, 50);

    // Also listen to scroll events
    const onScroll = () => applyColors(forceLight || window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [active, forceLight]);

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
                style={{ color: forceLight ? "#000000" : "#ffffff" }}
              >
                Zaino AI
              </span>
            </span>
          </a>
          <Separator
            orientation="vertical"
            data-sep=""
            className="hidden h-6 my-auto lg:block transition-colors duration-300"
            style={{ backgroundColor: forceLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.2)" }}
          />
          <div className="hidden items-center gap-1 lg:flex">
            {navLinks.map((link) => (
              <a
                key={link.title}
                href={link.href}
                data-navlink={link.title}
                className="rounded-full px-3 py-1.5 text-base font-medium whitespace-nowrap transition-colors duration-300"
                style={{
                  color: forceLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)",
                  backgroundColor: "transparent",
                }}
              >
                {link.title}
              </a>
            ))}
          </div>
        </div>
        <div className="hidden items-center gap-6 lg:flex">
          <a
            href="/sign-in"
            data-signin-right=""
            className="whitespace-nowrap text-base font-medium transition-colors duration-300"
            style={{ color: forceLight ? "#000000" : "#ffffff" }}
          >
            Sign in
          </a>
          <Button
            render={<a href="/sign-up" />}
            nativeButton={false}
            className="group h-10 rounded-full px-5 font-medium hover:bg-primary/80 cursor-pointer"
          >
            Get an API key
            <ChevronRight className="size-4 transition-all group-hover:translate-x-0.5 duration-300" />
          </Button>
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
              {navLinks.map((link) => (
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
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
};

export default Navbar;