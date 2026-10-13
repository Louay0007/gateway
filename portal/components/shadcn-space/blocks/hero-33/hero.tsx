"use client";

/**
 * hero-33 (shadcn-space registry block) — CONTENT OWNED BY US.
 *
 * The structure, motion, and classes below are the registry component
 * and are meant to stay that way. The copy (badge, headline, paragraph,
 * button labels) has been rewritten for this product; a
 * `shadcn add @shadcn-space/hero-33` would restore the marketplace
 * original, so re-apply this section if that ever happens.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

/**
 * The entrance is CSS (`--animate-hero-rise` in globals.css), not the
 * motion library: see the comment there. The registry component used
 * `whileInView`, which never fired for this element — the hero rendered
 * at `opacity: 0` and stayed invisible with no error.
 */
const RISE = "animate-hero-rise";

const Hero33 = () => {
  return (
    <section className="relative flex min-h-screen w-full flex-col overflow-hidden bg-background">
      {/*
        Hero image — local, self-hosted, optimized.

        Replaces the registry's remote video (an external CDN dependency
        and ~seconds of autoplay negotiation on every visit) with a
        still: it is the LCP element, so `priority` preloads it and skips
        lazy-loading, and `fill` + `object-cover` gives the exact
        full-bleed treatment the video had. `alt=""` because the image
        is mood, not content — the words on top of it carry the meaning.
      */}
      <Image
        src="/hero/enhanced_gradient_background.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />

      {/*
        White fade at the hero's foot.

        Without it the pastel image ends on a hard edge and the white
        sections below begin abruptly — the eye reads a seam, not a page.
        This dissolves the image into the same white the rest of the
        landing page uses, so the scroll is continuous.

        It is sized in vh (not rem) so the fade always covers the same
        proportion of the hero at any viewport height, and it sits ABOVE
        the image but BELOW the copy (z-[5] vs z-10): the headline lands
        on the washed end of the fade, where black text reads cleanest.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-[35vh] bg-gradient-to-t from-white via-white/70 to-transparent"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-end px-4 pt-28 pb-10 lg:px-8 lg:pb-16 xl:px-16">
        <div
          className={`flex w-full flex-col gap-4 lg:gap-8 lg:flex-row lg:items-end lg:justify-between ${RISE}`}
        >
          <div className="flex flex-col gap-4 max-w-137">
            <Badge
              variant="outline"
              className="h-7 w-fit rounded-full px-3 py-1 text-sm font-normal border-black text-black"
            >
              D17 & card payments · now live
            </Badge>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight text-black">
              One API for every model, priced for the way Tunisia pays
            </h1>
          </div>

          <div className="flex flex-col gap-3 sm:gap-4 lg:gap-8 max-w-122.5 lg:shrink-0">
            <p className="text-base sm:text-lg text-black">
              OpenAI- and Anthropic-compatible endpoints, spend ceilings that
              stop surprises, and instant keys — subscribe with a D17 transfer
              or a card, and start calling in minutes.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                render={<a href="/sign-up" />} nativeButton={false}
                className="group h-10 w-full rounded-full px-5 font-medium text-white bg-black hover:bg-black/80 sm:w-fit"
              >
                Start building
                <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Button>
              <Button
                render={<a href="/pricing" />} nativeButton={false}
                className="group h-10 w-full rounded-full px-5 font-medium hover:bg-primary/90 sm:w-fit"
              >
                See pricing
                <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero33;
