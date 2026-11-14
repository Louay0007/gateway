'use client';

import { AnimatedBeam, Circle } from '@/components/ui/animated-beam';
import { TextReveal } from '@/components/shadcn-space/animated-text/animated-text-06';
import { cn } from '@/lib/utils';
import { Ambient } from '@/components/marketing/ambient';
import React, { useRef } from 'react';

/**
 * The left node is "your editor", not a named vendor.
 *
 * TRADEMARK RULE (plans/linkedin-marketing-posts.md §1): a third-party logo
 * in marketing material implies sponsorship or affiliation, which we do not
 * have and cannot claim. This rendered the Claude mark on the homepage —
 * the single most visible surface we own. Compatibility is stated in text
 * on /connect and /docs, where naming a wire format is nominative use.
 *
 * A neutral terminal glyph says the same thing without the claim: the arrow
 * goes from your tool to Zaino.
 */
const ToolIcon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const ZainoLogo = () => (
  <img src="/images/zaino-logo.png" alt="Zaino AI" className="w-10 h-10 object-contain" />
);

const UserIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export default function AnimatedBeamSection({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolRef = useRef<HTMLDivElement>(null);
  const zainoRef = useRef<HTMLDivElement>(null);
  const user1Ref = useRef<HTMLDivElement>(null);
  const user2Ref = useRef<HTMLDivElement>(null);
  const user3Ref = useRef<HTMLDivElement>(null);
  const user4Ref = useRef<HTMLDivElement>(null);
  const user5Ref = useRef<HTMLDivElement>(null);

  return (
    <section className={cn('relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 overflow-hidden', className)}>
      <Ambient />
      <style>{`
        @keyframes float-drift {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
      `}</style>
      <h2 className="mb-8 text-center font-medium text-lg tracking-tight md:text-2xl text-white">
        <span className="text-white/60">One API.</span>{' '}
        <span className="font-semibold text-white">Every model connected.</span>
      </h2>
      <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
        <div
          className={cn(
            'relative flex w-full lg:w-1/2 max-w-[500px] items-center justify-center overflow-visible p-4',
          )}
          style={{ animation: 'float-drift 4s ease-in-out infinite', willChange: 'transform', transform: 'translateZ(0)' }}
          ref={containerRef}
        >
          <div className='flex h-full w-full flex-row items-stretch justify-between gap-8'>
            {/* Left: your tool — no vendor mark, see ToolIcon above. */}
            <div className='flex flex-col justify-center'>
              <Circle ref={toolRef} className="h-18 w-18 bg-[#0b0714] border-[#A558FB]/40 text-[#A558FB]">
                <ToolIcon />
              </Circle>
            </div>
            {/* Center: Zaino AI */}
            <div className='flex flex-col justify-center'>
              <Circle ref={zainoRef} className='h-20 w-20 bg-[#0b0714] border-[#A558FB]/50 shadow-[0_0_40px_rgba(165,88,251,0.25)] text-white'>
                <ZainoLogo />
              </Circle>
            </div>
            {/* Right: Multiple Users */}
            <div className='flex flex-col justify-center gap-2 text-white/80'>
              <Circle ref={user1Ref} className="h-14 w-14 bg-white/5 border-[#4922E5]/40">
                <UserIcon />
              </Circle>
              <Circle ref={user2Ref} className="h-14 w-14 bg-white/5 border-[#A558FB]/30">
                <UserIcon />
              </Circle>
              <Circle ref={user3Ref} className="h-14 w-14 bg-white/5 border-[#4922E5]/40">
                <UserIcon />
              </Circle>
              <Circle ref={user4Ref} className="h-14 w-14 bg-white/5 border-[#A558FB]/30">
                <UserIcon />
              </Circle>
              <Circle ref={user5Ref} className="h-14 w-14 bg-white/5 border-[#4922E5]/40">
                <UserIcon />
              </Circle>
            </div>
          </div>

          {/* AnimatedBeams: Users → Zaino */}
          <AnimatedBeam containerRef={containerRef} fromRef={user1Ref} toRef={zainoRef} duration={3} />
          <AnimatedBeam containerRef={containerRef} fromRef={user2Ref} toRef={zainoRef} duration={3} />
          <AnimatedBeam containerRef={containerRef} fromRef={user3Ref} toRef={zainoRef} duration={3} />
          <AnimatedBeam containerRef={containerRef} fromRef={user4Ref} toRef={zainoRef} duration={3} />
          <AnimatedBeam containerRef={containerRef} fromRef={user5Ref} toRef={zainoRef} duration={3} />
          {/* AnimatedBeam: your tool → Zaino */}
          <AnimatedBeam containerRef={containerRef} fromRef={zainoRef} toRef={toolRef} duration={3} reverse gradientStartColor="#4922E5" gradientStopColor="#A558FB" />
        </div>

        {/* Right: the throttling contrast, stated without naming a vendor */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center space-y-4">
          <TextReveal
            text="Other tools cap your usage and throttle you mid-flow. You hit limits, wait hours, and lose momentum."
            mode="word"
            as="p"
            delay={0.2}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="text-base sm:text-lg text-white/60 leading-relaxed"
          />
          <TextReveal
            text="Zaino gives you a shared token pool and no per-minute throttling — so a heavy hour costs you an hour, not a day. Just code."
            mode="word"
            as="p"
            delay={0.8}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="text-base sm:text-lg font-medium text-white leading-relaxed"
          />
        </div>
      </div>
    </section>
  );
}
