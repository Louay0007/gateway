'use client';

import { MacbookPro } from '@/components/ui/macbook-pro';
import { TextReveal } from '@/components/shadcn-space/animated-text/animated-text-06';
import { cn } from '@/lib/utils';

export default function MacbookSection({ className }: { className?: string }) {
  return (
    <section className={cn('relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8', className)}>
      <style jsx global>{`
        @keyframes macbook-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-14px); }
        }
      `}</style>
      <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
        {/* Left: TextReveal about Zaino AI Agent App */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center space-y-4">
          <TextReveal
            text="Meet your built-in AI agent app — powered by our own models, packed with full skills, autonomous agents, and real-time tool execution."
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
            text="Zaino AI doesn't just chat. It plans, codes, deploys, and iterates — all inside one desktop experience that feels like having a senior engineer on call 24/7."
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