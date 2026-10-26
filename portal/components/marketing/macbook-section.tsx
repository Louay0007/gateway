'use client';

import { MacbookPro } from '@/components/ui/macbook-pro';
import { HalloweenDots } from "@/components/marketing/halloween-dots";
import { TextReveal } from '@/components/shadcn-space/animated-text/animated-text-06';
import { cn } from '@/lib/utils';

export default function MacbookSection({ className }: { className?: string }) {
  return (
    <section className={cn('relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 overflow-hidden', className)}>
      {/* Halloween ambient background */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-[#000000]" />
        <img src="/images/halloween/shape-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-soft-light opacity-30" />
        <div className="absolute top-1/3 right-[10%] w-80 h-80 rounded-full bg-orange-500/8 blur-[90px] animate-[pulse_9s_ease-in-out_infinite]" />
        <div className="absolute bottom-1/3 left-[5%] w-60 h-60 rounded-full bg-purple-500/8 blur-[90px] animate-[pulse_11s_ease-in-out_infinite_reverse]" />
      <HalloweenDots />
      </div>
      <style>{`
        @keyframes macbook-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-14px); }
        }
      `}</style>
      <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
        {/* Left: TextReveal about Zaino AI Agent App — ghost sits under the text, clear of the laptop */}
        <div className="relative w-full lg:w-1/2 flex flex-col justify-center space-y-4">
          <img src="/images/halloween/about-scare.png" alt="" aria-hidden="true" className="pointer-events-none select-none opacity-90 absolute -top-16 -left-4 w-32 sm:w-44 md:w-56 h-auto" />
          <TextReveal
            text="A full AI agent app built right in. Autonomous coding, real-time execution, and every tool you need."
            mode="word"
            as="p"
            delay={0.2}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="relative text-base sm:text-lg text-white/60 leading-relaxed"
          />
          <TextReveal
            text="It plans, codes, and ships — like a senior engineer on call 24/7, all from one desktop app."
            mode="word"
            as="p"
            delay={0.8}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="relative text-base sm:text-lg font-medium text-white leading-relaxed"
          />
        </div>

        {/* Right: MacBook with Zaino Desktop App floating */}
        <div
          className="w-full lg:w-1/2 flex items-center justify-center"
          style={{ animation: 'macbook-float 5s ease-in-out infinite', willChange: 'transform', transform: 'translateZ(0)' }}
        >
          <MacbookPro
            src="/images/zaino-desktop-app.png"
            className="w-full max-w-[550px] drop-shadow-2xl"
          />
        </div>
      </div>
    </section>
  );
}
