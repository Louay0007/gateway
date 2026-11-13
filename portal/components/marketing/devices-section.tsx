'use client';

import { MacbookPro } from '@/components/ui/macbook-pro';
import IPhoneMockup from '@/components/ui/iphone-mockup';
import { Ambient } from '@/components/marketing/ambient';
import { TextReveal } from '@/components/shadcn-space/animated-text/animated-text-06';
import { cn } from '@/lib/utils';

const APP_STORE_URL =
  'https://apps.apple.com/us/app/zaino-open-webui-client/id6749840287';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.zainoai.app';

/**
 * Desktop + mobile, as one section.
 *
 * These were two separate sections — a MacBook with copy on its left, then
 * an iPhone with copy on its right — so the landing page showed the same
 * product twice and asked the visitor to scroll through two near-identical
 * pitches. Merging them puts the two mockups on ONE line, bottoms aligned,
 * beside a single copy block, which is also how the product actually works:
 * the same workspace, two screens.
 *
 * The phone is rendered at its natural 417×876 (iPhone 15 Pro frame) and
 * scaled by a CSS variable inside `.zaino-phone`. That matters: the
 * IPhoneMockup component keeps its unscaled layout box when given a `scale`
 * prop, which previously left ~500px of empty space under the phone and was
 * why the old section was 1151px tall. Sizing the wrapper to the scaled
 * frame lets `items-end` align the two devices honestly.
 */
export default function DevicesSection({ className }: { className?: string }) {
  return (
    <section
      className={cn(
        'relative mx-auto max-w-6xl overflow-hidden px-4 py-16 sm:px-6 lg:px-8',
        className,
      )}
    >
      <Ambient />
      <style>{`
        @keyframes device-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }

        /* 417 × 876 is the iPhone 15 Pro frame including its bezel. The
           wrapper is the SCALED size, so it participates in layout and the
           two devices can share a baseline. */
        .zaino-phone {
          --phone-s: 0.18;
          width: calc(417px * var(--phone-s));
          height: calc(876px * var(--phone-s));
        }
        .zaino-phone-scale {
          transform: scale(var(--phone-s));
          transform-origin: top left;
        }
        @media (min-width: 640px) {
          .zaino-phone { --phone-s: 0.24; }
        }
        @media (min-width: 1024px) {
          .zaino-phone { --phone-s: 0.285; }
        }
      `}</style>

      <div className="flex flex-col items-center gap-10 lg:flex-row lg:gap-14">
        {/* ── One pitch, both screens ─────────────────────────────── */}
        <div className="relative flex w-full flex-col justify-center space-y-4 lg:w-1/2">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">
            Desktop + mobile
          </p>
          <TextReveal
            text="A full AI agent app built right in. Autonomous coding, real-time execution, and every tool you need."
            mode="word"
            as="p"
            delay={0.2}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="relative text-base leading-relaxed text-white/60 sm:text-lg"
          />
          <TextReveal
            text="It plans, codes, and ships like a senior engineer on call 24/7. Start on your Mac, keep going from your phone."
            mode="word"
            as="p"
            delay={0.8}
            stagger={0.04}
            duration={0.6}
            blur="6px"
            y={8}
            className="relative text-base font-medium leading-relaxed text-white sm:text-lg"
          />

          <div className="flex items-center gap-4 pt-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-opacity hover:opacity-100"
            >
              <img
                src="/images/app-store-badge.svg"
                alt="Download on the App Store"
                className="h-10 opacity-80 transition-opacity hover:opacity-100"
              />
            </a>
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-opacity hover:opacity-100"
            >
              <img
                src="/images/google-play-badge.svg"
                alt="Get it on Google Play"
                className="h-10 opacity-80 transition-opacity hover:opacity-100"
              />
            </a>
          </div>
        </div>

        {/* ── Both mockups, one line, bottoms aligned ─────────────── */}
        <div className="flex w-full items-end justify-center gap-3 sm:gap-5 lg:w-1/2 lg:gap-4">
          <div
            className="w-[70%] max-w-[520px] sm:w-[72%] lg:w-[76%]"
            style={{
              animation: 'device-float 6s ease-in-out infinite',
              willChange: 'transform',
              transform: 'translateZ(0)',
            }}
          >
            <MacbookPro
              src="/images/zaino-desktop-app.png"
              className="h-auto w-full drop-shadow-2xl"
            />
          </div>

          <div
            className="zaino-phone relative shrink-0 drop-shadow-2xl"
            style={{
              animation: 'device-float 6s ease-in-out -2.5s infinite',
              willChange: 'transform',
              transform: 'translateZ(0)',
            }}
          >
            <div className="zaino-phone-scale">
              <IPhoneMockup
                model="15-pro"
                color="space-black"
                scale={1}
                wallpaper="/images/zaino-iphone-screen.png"
                wallpaperFit="cover"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
