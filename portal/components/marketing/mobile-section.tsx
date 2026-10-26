'use client';

import IPhoneMockup from '@/components/ui/iphone-mockup';
import { HalloweenDots } from "@/components/marketing/halloween-dots";
import { TextReveal } from '@/components/shadcn-space/animated-text/animated-text-06';
import { cn } from '@/lib/utils';

export default function MobileSection({ className }: { className?: string }) {
  return (
    <section className={cn('relative mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 overflow-hidden', className)}>
      {/* Halloween ambient background */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-[#000000]" />
        <img src="/images/halloween/shape-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-soft-light opacity-30" />
        <div className="absolute top-1/4 left-[8%] w-64 h-64 rounded-full bg-purple-500/10 blur-[80px] animate-[pulse_9s_ease-in-out_infinite]" />
        <div className="absolute bottom-1/4 right-[5%] w-72 h-72 rounded-full bg-orange-500/10 blur-[80px] animate-[pulse_11s_ease-in-out_infinite_reverse]" />
      <HalloweenDots />
      </div>
      <style>{`
        @keyframes iphone-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
      <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-10">
        {/* Left: iPhone mockup floating */}
        <div
          className="w-full lg:w-1/2 flex items-center justify-center lg:mt-12"
          style={{ animation: 'iphone-float 5s ease-in-out infinite', willChange: 'transform', transform: 'translateZ(0)' }}
        >
          <IPhoneMockup
            model="15-pro"
            color="space-black"
            scale={0.55}
            wallpaper="/images/zaino-iphone-screen.png"
            wallpaperFit="cover"
            className="drop-shadow-2xl max-w-[280px] sm:max-w-none sm:scale-[0.65]"
            style={{ transformOrigin: 'center center' }}
          />
        </div>

        {/* Right: TextReveal about mobile app + store badges — vertically centered with phone */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center items-start space-y-6 lg:py-8">
          <TextReveal
            text="Code from anywhere. Manage agents on the go. Your workspace, always with you."
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
            text="Full control, real-time sync, coming soon to iOS and Android."
            mode="word"
            as="p"
            delay={0.8}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="text-base sm:text-lg font-medium text-white leading-relaxed"
          />
          {/* Store badges */}
          <div className="flex items-center gap-4 pt-2">
            <img
              src="/images/app-store-badge.svg"
              alt="Download on the App Store"
              className="h-10 opacity-80 hover:opacity-100 transition-opacity"
            />
            <img
              src="/images/google-play-badge.svg"
              alt="Get it on Google Play"
              className="h-10 opacity-80 hover:opacity-100 transition-opacity"
            />
          </div>
        </div>
      </div>
      {/* Witch hat resting beside the phone */}
      <img src="/images/halloween/category-witch-hat.png" alt="" aria-hidden="true" className="absolute bottom-0 left-0 w-32 sm:w-44 md:w-56 h-auto opacity-90 pointer-events-none select-none" />
    </section>
  );
}
