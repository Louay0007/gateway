'use client';

import { AnimatedBeam, Circle } from '@/components/ui/animated-beam';
import { TextReveal } from '@/components/shadcn-space/animated-text/animated-text-06';
import { cn } from '@/lib/utils';
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
    <section className={cn('relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8', className)}>
      <h2 className="mb-8 text-center font-medium text-foreground text-lg tracking-tight md:text-2xl">
        <span className="text-muted-foreground">One API.</span>{' '}
        <span className="font-semibold">Every model connected.</span>
      </h2>
      <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
        {/* Left: Beam diagram with float animation */}
        <style jsx global>{`
          @keyframes float-drift {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-12px); }
          }
        `}</style>
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
              <Circle ref={claudeRef} className="h-18 w-18 bg-orange-50 border-orange-200">
                <ClaudeCodeIcon />
              </Circle>
            </div>
            {/* Center: Zaino AI */}
            <div className='flex flex-col justify-center'>
              <Circle ref={zainoRef} className='h-20 w-20 bg-white border-gray-200 shadow-lg'>
                <ZainoLogo />
              </Circle>
            </div>
            {/* Right: Multiple Users */}
            <div className='flex flex-col justify-center gap-2'>
              <Circle ref={user1Ref} className="h-14 w-14 bg-blue-50 border-blue-200">
                <UserIcon />
              </Circle>
              <Circle ref={user2Ref} className="h-14 w-14 bg-purple-50 border-purple-200">
                <UserIcon />
              </Circle>
              <Circle ref={user3Ref} className="h-14 w-14 bg-green-50 border-green-200">
                <UserIcon />
              </Circle>
              <Circle ref={user4Ref} className="h-14 w-14 bg-pink-50 border-pink-200">
                <UserIcon />
              </Circle>
              <Circle ref={user5Ref} className="h-14 w-14 bg-yellow-50 border-yellow-200">
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
            text="Claude Code's $20/month plan hits its limit fast. Heavy coding sessions burn through usage caps, leaving you throttled or waiting hours to continue. Teams face unpredictable overages and fragmented workflows when the meter runs out mid-task."
            mode="word"
            as="p"
            delay={0.2}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="text-base sm:text-lg text-muted-foreground leading-relaxed"
          />
          <TextReveal
            text="Zaino AI removes those ceilings entirely — unlimited access, no throttling, no surprise charges. One subscription, every model, zero friction."
            mode="word"
            as="p"
            delay={0.8}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="text-base sm:text-lg font-medium text-foreground leading-relaxed"
          />
        </div>
      </div>
    </section>
  );
}