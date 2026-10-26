import { cn } from "@/lib/utils";

/**
 * HalloweenDots — the ambient orange dot-grid that sits in the background
 * of every landing-page section (except the navbar and hero artwork).
 *
 * A radial-gradient dot pattern in the pumpkin orange (#ff7f2a), masked
 * with another radial gradient so the dots appear as a soft glowing field
 * in the middle of the section and dissolve toward the edges — it reads
 * as texture, not wallpaper.
 */
export function HalloweenDots({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("absolute inset-0 pointer-events-none select-none", className)}
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(255,127,42,0.30) 1.2px, transparent 1.2px)",
        backgroundSize: "22px 22px",
        WebkitMaskImage:
          "radial-gradient(ellipse 85% 70% at 50% 45%, black 0%, transparent 72%)",
        maskImage:
          "radial-gradient(ellipse 85% 70% at 50% 45%, black 0%, transparent 72%)",
      }}
    />
  );
}
