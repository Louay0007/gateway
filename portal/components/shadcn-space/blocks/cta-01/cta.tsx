"use client";
import { useRef, useCallback } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import gsap from "gsap";

type CTAProps = {
  className?: string;
};

const CTA = ({ className }: CTAProps) => {
  const ref = useRef(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  const bottomAnimation = {
    initial: { y: "5%", opacity: 0 },
    animate: { y: 0, opacity: 1 },
    transition: { duration: 1, delay: 0.8, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  };

  const handleMouseEnter = useCallback(() => {
    if (!btnRef.current || !iconRef.current || !textRef.current) return;
    const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.4 } });
    tl.to(btnRef.current, { paddingLeft: 56, paddingRight: 24 }, 0);
    tl.to(iconRef.current, { right: "calc(100% - 44px)", rotation: 45 }, 0);
    tl.to(textRef.current, { x: -4, opacity: 0.9 }, 0);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!btnRef.current || !iconRef.current || !textRef.current) return;
    const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.4 } });
    tl.to(btnRef.current, { paddingLeft: 24, paddingRight: 56 }, 0);
    tl.to(iconRef.current, { right: 4, rotation: 0 }, 0);
    tl.to(textRef.current, { x: 0, opacity: 1 }, 0);
  }, []);

  return (
    <section className={className}>
      <div className="sm:py-20 py-8">
        <div className="max-w-7xl mx-auto sm:px-16 px-4">
          <div
            ref={ref}
            className="relative overflow-hidden min-h-96 flex items-center justify-center px-6 border border-white/10 rounded-3xl before:absolute before:w-full before:h-4/5 before:bg-linear-to-r before:from-black before:from-15% before:via-[#0a1628] before:via-55% before:to-[#0f2847] before:to-90% before:rounded-full before:top-24 before:blur-3xl before:-z-10"
          >
            <motion.div
              {...bottomAnimation}
              className="flex flex-col gap-6 items-center mx-auto"
            >
              <div className="flex flex-col gap-3 items-center text-center">
                <h2 className="text-3xl md:text-5xl font-medium text-white">
                  Ready to unlock unlimited AI power?
                </h2>
                <p className="max-w-2xl mx-auto text-white/70">
                  Join thousands of developers and teams using Zaino AI to build faster, code smarter, and ship with confidence. Start your free trial today.
                </p>
              </div>
              <Button
                ref={btnRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className="relative text-sm font-medium rounded-full h-12 p-1 ps-6 pe-14 w-fit overflow-hidden bg-white dark:bg-gray-900 text-black dark:text-gray-100 hover:bg-white/90 dark:hover:bg-gray-800 cursor-pointer border-0"
              >
                <span ref={textRef} className="relative z-10">
                  Get Started Now
                </span>
                <div
                  ref={iconRef}
                  className="absolute right-1 w-10 h-10 bg-gray-900 dark:bg-gray-700 text-white rounded-full flex items-center justify-center"
                >
                  <ArrowUpRight size={16} />
                </div>
              </Button>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTA;