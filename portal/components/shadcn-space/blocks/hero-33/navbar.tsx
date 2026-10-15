"use client";

import { useEffect, useState } from "react";
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

// CONTENT OWNED BY US — a registry refresh restores the placeholder nav.
// Every entry here resolves to a route that exists: /docs renders the
// public integration guide (same body as /dashboard/docs).
const navLinks = [
  { title: "Docs", href: "/docs", isActive: false },
  { title: "Pricing", href: "/pricing", isActive: true },
  { title: "Sign in", href: "/sign-in" },
];

const Navbar = () => {
  const [isSticky, setIsSticky] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsSticky(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={cn(
        "dark absolute inset-x-0 top-0 z-50 w-full transition-all duration-300",
        isSticky
          ? "bg-background shadow-lg shadow-black/5 backdrop-blur-lg"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8 xl:px-16">
        <div className="flex items-center gap-4 lg:gap-6">
          <a href="/" className="shrink-0">
            <Logo />
          </a>
          <Separator
            orientation="vertical"
            className="hidden h-6 my-auto lg:block bg-foreground/20"
          />
          <div className="hidden items-center gap-1 lg:flex">
            {navLinks.map((link) => (
              <a
                key={link.title}
                href={link.href}
                className={cn(
                  "rounded-full px-3 py-1.5 text-base font-medium whitespace-nowrap transition-colors",
                  link.isActive
                    ? "bg-foreground/20 text-foreground"
                    : "text-foreground/70 hover:text-foreground",
                )}
              >
                {link.title}
              </a>
            ))}
          </div>
        </div>

        <div className="hidden items-center gap-6 lg:flex">
          <a
            href="/sign-in"
            className="whitespace-nowrap text-foreground transition-colors hover:text-foreground/80"
          >
            Sign in
          </a>
          <Button
            render={<a href="/sign-up" />} nativeButton={false}
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
            className="dark flex flex-col gap-6 overflow-auto border-l border-border bg-background p-4 sm:p-6 no-scrollbar"
          >
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>

            <SheetHeader className="flex-row items-center justify-between p-0">
              <SheetClose
                nativeButton={false}
                render={
                  <a href="#">
                    <Logo />
                  </a>
                }
              />
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
                        "rounded-lg px-3 py-2 text-base font-normal hover:bg-primary/10 hover:text-foreground",
                        link.isActive
                          ? "bg-primary/20 text-foreground"
                          : "text-muted-foreground",
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
                  <a
                    href="/sign-in"
                    className="text-foreground transition-colors hover:text-foreground/80"
                  >
                    Sign in
                  </a>
                }
              />
              <SheetClose
                render={
                  <Button
                    render={<a href="/sign-up" />} nativeButton={false}
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
