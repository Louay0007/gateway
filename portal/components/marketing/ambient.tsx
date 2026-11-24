/**
 * The landing page's ambient background: a violet dot field with two soft
 * orbs. One component so every section shares the same texture instead of
 * eight hand-copied variants drifting apart.
 *
 * Violet is the brand accent; the orbs are the horizon's two glow colours
 * at low opacity, so a section's edge picks up the same light the hero
 * emits. All four values are `--mkt-*` tokens, so the texture is violet on
 * black in dark mode and a much fainter violet wash on white in light mode
 * — the same 0.16 alpha that reads as "barely there" on #050507 reads as a
 * grey smear on #ffffff, which is why the light values are lower rather
 * than identical.
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
            'radial-gradient(circle, var(--mkt-dot) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          WebkitMaskImage:
            'radial-gradient(ellipse 85% 70% at 50% 45%, black 0%, transparent 72%)',
          maskImage:
            'radial-gradient(ellipse 85% 70% at 50% 45%, black 0%, transparent 72%)',
        }}
      />
      <div className="absolute -top-24 left-[8%] size-72 rounded-full blur-[90px]" style={{ background: 'var(--mkt-glow-1)' }} />
      <div className="absolute bottom-0 right-[6%] size-80 rounded-full blur-[100px]" style={{ background: 'var(--mkt-glow-2)' }} />
    </div>
  );
}
