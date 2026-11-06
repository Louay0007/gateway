/**
 * The landing page's ambient background: a violet dot field with two soft
 * orbs. One component so every section shares the same texture instead of
 * eight hand-copied variants drifting apart.
 *
 * Violet is the brand accent; the orbs are the horizon's two glow colours
 * (#4922E5 deep, #A558FB near) at low opacity, so a section's edge picks up
 * the same light the hero emits.
 */
export function Ambient({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden ${className ?? ''}`}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(165,88,251,0.16) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          WebkitMaskImage:
            'radial-gradient(ellipse 85% 70% at 50% 45%, black 0%, transparent 72%)',
          maskImage:
            'radial-gradient(ellipse 85% 70% at 50% 45%, black 0%, transparent 72%)',
        }}
      />
      <div className="absolute -top-24 left-[8%] size-72 rounded-full bg-[#4922E5]/12 blur-[90px]" />
      <div className="absolute bottom-0 right-[6%] size-80 rounded-full bg-[#A558FB]/10 blur-[100px]" />
    </div>
  );
}
