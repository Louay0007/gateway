// GradientBackground — "Oceanic Shimmer"
// Pure CSS gradient background. Zero dependencies.
export function GradientBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: "#123A6B",
        backgroundImage: [
          "linear-gradient(to bottom, transparent 70%, #ffffff 100%)",
          "radial-gradient(150% 48.4% at 41.58% 6%, rgba(234, 247, 251, 0.92) 0%, rgba(234, 247, 251, 0) 53%)",
          "radial-gradient(150% 48.4% at 42.42% 33%, rgba(127, 198, 230, 0.92) 0%, rgba(127, 198, 230, 0) 53%)",
          "radial-gradient(150% 48.4% at 51.19% 67%, rgba(46, 124, 192, 0.92) 0%, rgba(46, 124, 192, 0) 53%)",
          "radial-gradient(150% 48.4% at 53.67% 94%, rgba(18, 58, 107, 0.92) 0%, rgba(18, 58, 107, 0) 53%)",
        ].join(", "),
      }}
    />
  );
}