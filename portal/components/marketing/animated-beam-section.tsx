'use client';

import { AnimatedBeam, Circle } from '@/components/ui/animated-beam';
import { TextReveal } from '@/components/shadcn-space/animated-text/animated-text-06';
import { cn } from '@/lib/utils';
import { HalloweenDots } from "@/components/marketing/halloween-dots";
import React, { useRef } from 'react';

const ClaudeCodeIcon = () => (
  <img src="/images/claude-ai-icon.svg" alt="Claude AI" className="w-10 h-10 object-contain" />
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
  const claudeRef = useRef<HTMLDivElement>(null);
  const zainoRef = useRef<HTMLDivElement>(null);
  const user1Ref = useRef<HTMLDivElement>(null);
  const user2Ref = useRef<HTMLDivElement>(null);
  const user3Ref = useRef<HTMLDivElement>(null);
  const user4Ref = useRef<HTMLDivElement>(null);
  const user5Ref = useRef<HTMLDivElement>(null);

  return (
    <section className={cn('relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 overflow-hidden', className)}>
      {/* Halloween ambient background */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-[#000000]" />
        <img src="/images/halloween/shape-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-soft-light opacity-30" />
        <div className="absolute top-1/4 left-[5%] w-72 h-72 rounded-full bg-orange-500/10 blur-[80px] animate-[pulse_8s_ease-in-out_infinite]" />
        <div className="absolute bottom-1/4 right-[8%] w-64 h-64 rounded-full bg-purple-500/10 blur-[80px] animate-[pulse_10s_ease-in-out_infinite_reverse]" />
        <HalloweenDots />
        {/* Spider hanging over the beam diagram */}
        <img src="/images/halloween/item-spider.png" alt="" aria-hidden="true" className="absolute top-0 right-[30%] w-16 sm:w-24 md:w-28 h-auto opacity-90 pointer-events-none select-none animate-[pulse_5s_ease-in-out_infinite]" />
      </div>
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
            {/* Left: Claude Code solo */}
            <div className='flex flex-col justify-center'>
              <Circle ref={claudeRef} className="h-18 w-18 bg-[#1a0b2e] border-orange-500/40 text-orange-300">
                <ClaudeCodeIcon />
              </Circle>
            </div>
            {/* Center: Zaino AI */}
            <div className='flex flex-col justify-center'>
              <Circle ref={zainoRef} className='h-20 w-20 bg-[#1a0b2e] border-purple-500/40 shadow-[0_0_40px_rgba(255,140,0,0.25)] text-white'>
                <ZainoLogo />
              </Circle>
            </div>
            {/* Right: Multiple Users */}
            <div className='flex flex-col justify-center gap-2 text-white/80'>
              <Circle ref={user1Ref} className="h-14 w-14 bg-white/5 border-orange-500/30">
                <UserIcon />
              </Circle>
              <Circle ref={user2Ref} className="h-14 w-14 bg-white/5 border-purple-500/30">
                <UserIcon />
              </Circle>
              <Circle ref={user3Ref} className="h-14 w-14 bg-white/5 border-orange-500/30">
                <UserIcon />
              </Circle>
              <Circle ref={user4Ref} className="h-14 w-14 bg-white/5 border-purple-500/30">
                <UserIcon />
              </Circle>
              <Circle ref={user5Ref} className="h-14 w-14 bg-white/5 border-orange-500/30">
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
          {/* AnimatedBeam: Zaino → Claude Code */}
          <AnimatedBeam containerRef={containerRef} fromRef={zainoRef} toRef={claudeRef} duration={3} reverse gradientStartColor="#D97706" gradientStopColor="#F59E0B" />
        </div>

        {/* Right: TextReveal paragraph about Claude Code $20 limitations */}
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
            text="Zaino gives you every model with no throttling, no surprises, and no waiting. Just code."
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
