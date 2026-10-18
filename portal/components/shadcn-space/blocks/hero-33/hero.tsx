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

import { GradientBackground } from "@/components/ui/oceanic-shimmer";
import { useEffect, useRef } from "react";
import gsap from "gsap";

const headlineWords = [
  "Code",
  "Without",
  "Limits.",
  "One",
  "API.",
  "Every",
  "Model.",
];

const Hero33 = () => {
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const mascotRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!headlineRef.current) return;

    const words = headlineRef.current.querySelectorAll<HTMLElement>(".word");
    if (!words.length) return;

    let gsapRan = false;

    try {
      // Force high-FPS ticker for smoothest possible animation
      gsap.ticker.fps(120);

      // Remove CSS animation classes so GSAP takes over without conflict
      words.forEach((w) => w.classList.remove("animate-[word-rise_0.9s_cubic-bezier(0.16,1,0.3,1)_both]"));
      words.forEach((w) => {
        w.style.opacity = "0";
        w.style.willChange = "transform, opacity";
        w.style.animationDelay = "";
        w.style.animationFillMode = "";
      });

      const tl = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => {
          gsapRan = true;
          // Clean up will-change after animation completes to free GPU memory
          words.forEach((w) => { w.style.willChange = "auto"; });
        },
      });

      // Headline blur reveal
      tl.fromTo(
        headlineRef.current,
        { filter: "blur(12px)" },
        { filter: "blur(0px)", duration: 0.9 },
        0
      );

      // Per-word rise animation
      tl.fromTo(
        words,
        { y: 80, opacity: 0, rotateX: -40 },
        { y: 0, opacity: 1, rotateX: 0, stagger: 0.07, duration: 0.9 },
        0.15
      );

      // Screenshot + Mascot entry animation synced after last word ("Limits.")
      const screenshotEl = document.querySelector(".screenshot-reveal") as HTMLElement | null;
      if (mascotRef.current) {
        const lastWordDelay = 0.15 + (words.length - 1) * 0.07;
        // Screenshot fades in slightly before mascot
        if (screenshotEl) {
          tl.fromTo(
            screenshotEl,
            { opacity: 0, y: 30, scale: 0.95 },
            { opacity: 1, y: 0, scale: 1, duration: 0.9, ease: "power2.out" },
            lastWordDelay + 0.15
          );
        }
        tl.fromTo(
          mascotRef.current,
          { scale: 0, opacity: 0, y: 20 },
          { scale: 1, opacity: 1, y: 0, duration: 0.8, ease: "back.out(1.7)" },
          lastWordDelay + 0.3
        );
      }

      return () => {
        tl.kill();
      };
    } catch {
      // GSAP not available — restore CSS animation
      words.forEach((w) => {
        w.style.opacity = "";
        w.style.animationDelay = "";
        w.style.animationFillMode = "";
      });
    }
  }, []);

  return (
    <section className="relative w-full overflow-hidden">
      {/* Oceanic Shimmer gradient background */}
      <GradientBackground />

      <div className="relative z-10 mx-auto flex min-h-[80vh] max-w-5xl flex-col items-center justify-end px-4 pt-24 pb-16 text-center sm:px-6 lg:px-8">
        {/* Mascot overlapping top of screenshot frame */}
        <div className="relative mt-28 flex flex-col items-center sm:mt-32 md:mt-36 lg:mt-40">
          {/* Headline with per-word animation — just before mascot */}
          <h2 ref={headlineRef} className="mb-6 text-3xl font-bold tracking-tight text-white sm:mb-8 sm:text-4xl md:mb-10 md:text-5xl lg:mb-12 lg:text-6xl">
            {headlineWords.map((word, i) => (
              <span
                key={i}
                className="word inline-block animate-[word-rise_0.9s_cubic-bezier(0.16,1,0.3,1)_both] opacity-0"
                style={{
                  animationDelay: `${i * 0.07 + 0.15}s`,
                  animationFillMode: "forwards",
                }}
              >
                {word === "—" ? "\u00A0—\u00A0" : word + "\u00A0"}
              </span>
            ))}
          </h2>
          {/* Claude mascot — sits above and overlaps the screenshot border */}
          <img
            ref={mascotRef}
            src="/images/claude-mascot.png"
            alt="Claude mascot"
            className="relative z-20 w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 object-contain pointer-events-none select-none opacity-0 mb-[-2rem] sm:mb-[-2.5rem] md:mb-[-3rem] lg:mb-[-3.5rem]"
          />
          {/* Screenshot as big bordered frame underneath */}
          <img
            src="/images/opencode-screenshot.png"
            alt=""
            aria-hidden="true"
            className="relative z-10 w-[90vw] max-w-2xl sm:max-w-3xl md:max-w-4xl lg:max-w-5xl rounded-2xl border-4 border-white/20 shadow-2xl opacity-0 pointer-events-none select-none screenshot-reveal"
          />
        </div>
      </div>
    </section>
  );
};

export default Hero33;