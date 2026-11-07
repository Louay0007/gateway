"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Loader — the "working" indicator while a turn has nothing to show yet.
 *
 * On a heavy task the first token can be many seconds away, and a bare
 * dot row reads as a frozen page. This is one self-contained detail, in
 * the shape the eye reads first:
 *
 *   0s   a breathing gradient orb with expanding rings, a shimmer-swept
 *        phrase ("Thinking") and three hopping dots — "something in
 *        progress" lands before a word is read; two skeleton bars below
 *        show the answer taking shape
 *   3s   an elapsed-seconds pill appears (tabular figures, so the count
 *        advances smoothly instead of jiggling digits)
 *   7s+  the phrase cycles quietly ("Reasoning" → "Analyzing" →
 *        "Working through it" → "Still working") so a long deliberation
 *        never reads as a frozen screen
 *
 * The motion is CSS (globals.css) and collapses under prefers-reduced-
 * motion; only the seconds ticker is JS, and it lives and dies with this
 * component's mount — an aborted stream unmounts it and clears the
 * interval with the render.
 */
const PHASE_START = 7 // seconds before the first phrase rotation
const PHRASES = ["Reasoning", "Analyzing", "Working through it", "Still working"] as const

export function Loader({
  label = "Thinking",
  className,
  ...props
}: React.ComponentProps<"span"> & { label?: string }) {
  const elapsed = useElapsedSeconds()
  const phaseIndex = Math.min(
    PHRASES.length - 1,
    Math.max(0, Math.floor((elapsed - PHASE_START) / PHASE_START)),
  )
  const phrase = elapsed >= PHASE_START ? PHRASES[phaseIndex] : label

  return (
    <span
      data-slot="loader"
      role="status"
      // Announced once when the turn starts; the later visual changes
      // (seconds ticking, phrase rotating) must not re-announce — a
      // screen reader still gets `aria-busy` on the message log.
      aria-label={`${label} — the model is working on your request`}
      className={cn("thinking-enter inline-flex w-full flex-col gap-2.5", className)}
      {...props}
    >
      <span className="inline-flex items-center gap-2">
        {/* Breathing orb: gradient core, two expanding rings. */}
        <span aria-hidden className="relative flex size-4 shrink-0 items-center justify-center">
          <span className="thinking-orb-ring absolute inset-0 rounded-full border border-foreground/40" />
          <span
            aria-hidden
            className="thinking-orb-ring absolute inset-0 rounded-full border border-foreground/25"
            style={{ animationDelay: "0.9s" }}
          />
          <span className="thinking-orb-core relative size-2.5 rounded-full" />
        </span>

        {/* Shimmer phrase: a light bar sweeps across the words in place,
            so the eye catches movement without the text moving. */}
        <span aria-hidden className="thinking-shimmer text-[13px] font-medium">
          {phrase}
        </span>

        {/* Hopping dots — the classic "still going" beat. */}
        <span aria-hidden className="ml-0.5 inline-flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="thinking-dot size-1 rounded-full bg-foreground/70" />
          ))}
        </span>

        {/* Elapsed time, once waiting has gone long enough to need proof. */}
        {elapsed >= 3 ? (
          <span
            aria-hidden
            className="ml-1 rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] tabular text-muted-foreground"
          >
            {elapsed}s
          </span>
        ) : null}
      </span>

      {/* The answer taking shape — two muted bars the shimmer sweeps
          through. Widths stop short of the column so the placeholder
          never pretends to already be the reply. */}
      <span aria-hidden className="flex flex-col gap-2">
        <span className="thinking-skeleton block h-2.5 w-[72%] rounded-full" />
        <span
          className="thinking-skeleton block h-2.5 w-[48%] rounded-full"
          style={{ animationDelay: "0.35s" }}
        />
      </span>

      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * Whole seconds since mount. One interval, no drift-correction ceremony:
 * the readout is a human cue, not a clock.
 */
function useElapsedSeconds() {
  const [elapsed, setElapsed] = React.useState(0)
  React.useEffect(() => {
    const beganAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - beganAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])
  return elapsed
}
