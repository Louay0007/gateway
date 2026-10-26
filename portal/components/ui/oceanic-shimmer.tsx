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
        // Halloween theme — dark purple/orange palette from reference repo
        ["--shimmer-bg" as string]: "#000000",
        ["--shimmer-fade" as string]: "#1a0b2e",
        ["--shimmer-glow-1" as string]: "rgba(255, 140, 0, 0.35)",
        ["--shimmer-glow-2" as string]: "rgba(168, 85, 247, 0.30)",
        ["--shimmer-glow-3" as string]: "rgba(234, 88, 12, 0.25)",
        ["--shimmer-glow-4" as string]: "rgba(139, 92, 246, 0.20)",
        backgroundColor: "var(--shimmer-bg)",
        backgroundImage: [
          "linear-gradient(to bottom, transparent 70%, var(--shimmer-fade) 100%)",
          "radial-gradient(150% 48.4% at 41.58% 6%, var(--shimmer-glow-1) 0%, rgba(255, 140, 0, 0) 53%)",
          "radial-gradient(150% 48.4% at 42.42% 33%, var(--shimmer-glow-2) 0%, rgba(168, 85, 247, 0) 53%)",
          "radial-gradient(150% 48.4% at 51.19% 67%, var(--shimmer-glow-3) 0%, rgba(234, 88, 12, 0) 53%)",
          "radial-gradient(150% 48.4% at 53.67% 94%, var(--shimmer-glow-4) 0%, rgba(139, 92, 246, 0) 53%)",
        ].join(", "),
      }}
    >
      {/* Halloween ambient orbs + texture overlay */}
      <style>{`
        @keyframes halloween-drift {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0; }
          15% { opacity: 0.5; }
          85% { opacity: 0.5; }
          50% { transform: translateY(-100px) scale(1.15); }
        }
      `}</style>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          width: 350,
          height: 350,
          borderRadius: "50%",
          pointerEvents: "none",
          filter: "blur(60px)",
          background: "rgba(255, 140, 0, 0.12)",
          top: "15%",
          left: "8%",
          animation: "halloween-drift 9s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          width: 280,
          height: 280,
          borderRadius: "50%",
          pointerEvents: "none",
          filter: "blur(60px)",
          background: "rgba(168, 85, 247, 0.10)",
          bottom: "25%",
          right: "12%",
          animation: "halloween-drift 11s ease-in-out infinite reverse",
        }}
      />
      {/* Shape-bg texture overlay from reference repo */}
      <img
        src="/images/halloween/shape-bg.png"
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          mixBlendMode: "soft-light",
          opacity: 0.4,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
