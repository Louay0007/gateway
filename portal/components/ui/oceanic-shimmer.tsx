// GradientBackground — "Oceanic Shimmer"
// Pure CSS gradient background with dark mode support via CSS custom properties.
// Zero dependencies.
export function GradientBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        // Light mode colors (default)
        ["--shimmer-bg" as string]: "#123A6B",
        ["--shimmer-fade" as string]: "#ffffff",
        ["--shimmer-glow-1" as string]: "rgba(234, 247, 251, 0.92)",
        ["--shimmer-glow-2" as string]: "rgba(127, 198, 230, 0.92)",
        ["--shimmer-glow-3" as string]: "rgba(46, 124, 192, 0.92)",
        ["--shimmer-glow-4" as string]: "rgba(18, 58, 107, 0.92)",
        backgroundColor: "var(--shimmer-bg)",
        backgroundImage: [
          "linear-gradient(to bottom, transparent 70%, var(--shimmer-fade) 100%)",
          "radial-gradient(150% 48.4% at 41.58% 6%, var(--shimmer-glow-1) 0%, rgba(234, 247, 251, 0) 53%)",
          "radial-gradient(150% 48.4% at 42.42% 33%, var(--shimmer-glow-2) 0%, rgba(127, 198, 230, 0) 53%)",
          "radial-gradient(150% 48.4% at 51.19% 67%, var(--shimmer-glow-3) 0%, rgba(46, 124, 192, 0) 53%)",
          "radial-gradient(150% 48.4% at 53.67% 94%, var(--shimmer-glow-4) 0%, rgba(18, 58, 107, 0) 53%)",
        ].join(", "),
      }}
    >
      {/* Dark mode overrides via inline style tag scoped to this element */}
      <style>{`
        .dark & {
          --shimmer-bg: #0a1628;
          --shimmer-fade: #0f172a;
          --shimmer-glow-1: rgba(30, 58, 95, 0.6);
          --shimmer-glow-2: rgba(20, 60, 100, 0.5);
          --shimmer-glow-3: rgba(15, 45, 80, 0.4);
          --shimmer-glow-4: rgba(10, 22, 40, 0.3);
        }
      `}</style>
    </div>
  );
}