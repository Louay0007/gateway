"use client"

import * as React from "react"
import { cn } from "cn"
import { ArrowDown, ArrowUp } from "lucide-react"

/**
 * Message Scroller — the transcript frame.
 *
 * THE BEHAVIOUR THIS OWNS, and why each rule exists:
 *
 *   1. A NEW TURN ANCHORS NEAR THE TOP. The person's question settles at
 *      the top of the viewport with a peek of the previous turn above it,
 *      and the reply streams into the room below. The reader starts the
 *      answer at its first line instead of chasing the bottom of the page.
 *   2. FOLLOWING IS OPT-IN AND REVOCABLE. `autoScroll` follows the reply
 *      only while the reader is at the live edge. Scroll up — wheel, touch,
 *      keys, scrollbar — and the view stops moving while words keep
 *      arriving. Jump button brings them back and resumes following.
 *   3. SCROLLING NEVER RERENDERS A ROW. Position and follow state are
 *      tracked imperatively and mirrored onto the frame as `data-*`
 *      attributes. The rows are the expensive thing; a 60fps scroll that
 *      setState()s per frame would drop the stream.
 *
 * WHY NOT JUST PIN TO THE BOTTOM (what this replaced): an always-bottom
 * transcript yanks the viewport away the moment the user scrolls up to
 * re-read, and it makes a long answer impossible to start reading until it
 * finishes. Anchoring + opt-in follow is the whole point of the component.
 */

interface ScrollState {
  /** Content is hidden above the viewport. */
  start: boolean
  /** Content is hidden below the viewport. */
  end: boolean
}

interface MessageScrollerContextValue {
  viewportRef: React.RefObject<HTMLDivElement | null>
  autoScroll: boolean
  scrollPreviousItemPeek: number
  scrollMargin: number
  scrollEdgeThreshold: number
  scrollable: ScrollState
  /** Imperative: scroll a specific row into view. Returns false if unknown. */
  scrollToMessage: (id: string, opts?: ScrollToOptions) => boolean
  scrollToEnd: (opts?: { behavior?: ScrollBehavior }) => void
  scrollToStart: (opts?: { behavior?: ScrollBehavior }) => void
  /** Set while the reader is at the live edge, so appends follow. */
  stickRef: React.MutableRefObject<boolean>
  /** Anchors registered by items, in DOM order. */
  anchorsRef: React.MutableRefObject<string[]>
  notifyScroll: () => void
}

const MessageScrollerContext = React.createContext<MessageScrollerContextValue | null>(null)

function useMessageScrollerContext(component: string): MessageScrollerContextValue {
  const ctx = React.useContext(MessageScrollerContext)
  if (!ctx) {
    throw new Error(`${component} must be used inside <MessageScrollerProvider>`)
  }
  return ctx
}

export interface MessageScrollerProviderProps {
  children: React.ReactNode
  /** Follow the stream while the reader stays at the live edge. Off by default. */
  autoScroll?: boolean
  /** How much of the previous turn stays visible above a new anchor. */
  scrollPreviousItemPeek?: number
  /** Extra room at the top edge, on top of the peek. */
  scrollMargin?: number
  /** How close to an edge still counts as *at* it. */
  scrollEdgeThreshold?: number
  /**
   * Where a restored transcript lands. `last-anchor` is the right default
   * for a reopened chat: the reader sees what they asked and where the
   * answer starts, rather than the bottom of a long reply.
   */
  defaultScrollPosition?: "start" | "end" | "last-anchor"
}

export function MessageScrollerProvider({
  children,
  autoScroll = false,
  scrollPreviousItemPeek = 64,
  scrollMargin = 24,
  scrollEdgeThreshold = 8,
  defaultScrollPosition = "end",
}: MessageScrollerProviderProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const stickRef = React.useRef(true)
  const anchorsRef = React.useRef<string[]>([])
  const [scrollable, setScrollable] = React.useState<ScrollState>({ start: false, end: false })
  const initialised = React.useRef(false)

  const measure = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const atStart = el.scrollTop <= scrollEdgeThreshold
    const atEnd =
      el.scrollHeight - el.scrollTop - el.clientHeight <= scrollEdgeThreshold
    const start = el.scrollTop > scrollEdgeThreshold
    const end = !atEnd
    stickRef.current = atEnd
    setScrollable((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    el.dataset.scrollable =
      start && end ? "both" : start ? "start" : end ? "end" : ""
  }, [scrollEdgeThreshold])

  const scrollToEnd = React.useCallback((opts?: { behavior?: ScrollBehavior }) => {
    const el = viewportRef.current
    if (!el) return
    stickRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: opts?.behavior ?? "auto" })
    measure()
  }, [measure])

  const scrollToStart = React.useCallback((opts?: { behavior?: ScrollBehavior }) => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTo({ top: 0, behavior: opts?.behavior ?? "auto" })
    measure()
  }, [measure])

  const scrollToMessage = React.useCallback(
    (id: string, opts?: ScrollToOptions) => {
      const el = viewportRef.current
      if (!el) return false
      const target = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
      if (!target) return false
      const top =
        target.getBoundingClientRect().top -
        el.getBoundingClientRect().top +
        el.scrollTop -
        scrollPreviousItemPeek -
        scrollMargin
      el.scrollTo({ top: Math.max(top, 0), behavior: opts?.behavior ?? "smooth" })
      return true
    },
    [scrollPreviousItemPeek, scrollMargin],
  )

  // Apply the initial landing position once, after rows have mounted.
  React.useEffect(() => {
    if (initialised.current) return
    initialised.current = true
    const el = viewportRef.current
    if (!el) return
    if (defaultScrollPosition === "start") {
      el.scrollTop = 0
    } else if (defaultScrollPosition === "last-anchor") {
      const last = anchorsRef.current[anchorsRef.current.length - 1]
      if (last) {
        const target = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(last)}"]`)
        if (target) {
          const top =
            target.getBoundingClientRect().top -
            el.getBoundingClientRect().top +
            el.scrollTop -
            scrollPreviousItemPeek -
            scrollMargin
          el.scrollTop = Math.max(top, 0)
        } else {
          el.scrollTop = el.scrollHeight
        }
      } else {
        el.scrollTop = el.scrollHeight
      }
    } else {
      el.scrollTop = el.scrollHeight
    }
    measure()
  }, [defaultScrollPosition, measure, scrollMargin, scrollPreviousItemPeek])

  const value = React.useMemo<MessageScrollerContextValue>(
    () => ({
      viewportRef,
      autoScroll,
      scrollPreviousItemPeek,
      scrollMargin,
      scrollEdgeThreshold,
      scrollable,
      scrollToMessage,
      scrollToEnd,
      scrollToStart,
      stickRef,
      anchorsRef,
      notifyScroll: measure,
    }),
    [
      autoScroll,
      scrollPreviousItemPeek,
      scrollMargin,
      scrollEdgeThreshold,
      scrollable,
      scrollToMessage,
      scrollToEnd,
      scrollToStart,
      measure,
    ],
  )

  return (
    <MessageScrollerContext.Provider value={value}>{children}</MessageScrollerContext.Provider>
  )
}

export function MessageScroller({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const ctx = useMessageScrollerContext("MessageScroller")
  return (
    <div
      data-slot="message-scroller"
      data-autoscrolling={ctx.autoScroll && ctx.scrollable.end ? "" : undefined}
      className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function MessageScrollerViewport({
  className,
  children,
  onScroll,
  ...props
}: React.ComponentProps<"div">) {
  const ctx = useMessageScrollerContext("MessageScrollerViewport")

  return (
    <div
      ref={ctx.viewportRef}
      data-slot="message-scroller-viewport"
      // A focusable, named region so a keyboard user can reach the
      // transcript and scroll it without tabbing through every row.
      role="region"
      aria-label="Messages"
      tabIndex={0}
      onScroll={(e) => {
        ctx.notifyScroll()
        onScroll?.(e)
      }}
      className={cn(
        "chat-scroll min-h-0 flex-1 overflow-y-auto outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-ring/30",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function MessageScrollerContent({
  className,
  children,
  busy,
  ...props
}: React.ComponentProps<"div"> & { busy?: boolean }) {
  return (
    <div
      data-slot="message-scroller-content"
      // A log, not a status: new rows are announced, but a reply growing
      // word by word is not read out token by token. `aria-busy` holds the
      // announcement until the turn finishes.
      role="log"
      aria-relevant="additions"
      aria-busy={busy || undefined}
      className={cn("mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function MessageScrollerItem({
  messageId,
  scrollAnchor = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  messageId: string
  /** Marks the row that STARTS a turn — normally the person's message. */
  scrollAnchor?: boolean
}) {
  const ctx = useMessageScrollerContext("MessageScrollerItem")
  const ref = React.useRef<HTMLDivElement | null>(null)

  // Register anchors in DOM order so `last-anchor` can find the newest turn.
  React.useEffect(() => {
    if (!scrollAnchor) return
    const list = ctx.anchorsRef.current
    if (!list.includes(messageId)) list.push(messageId)
    return () => {
      const i = list.indexOf(messageId)
      if (i !== -1) list.splice(i, 1)
    }
  }, [ctx.anchorsRef, messageId, scrollAnchor])

  return (
    <div
      ref={ref}
      data-slot="message-scroller-item"
      data-message-id={messageId}
      data-anchor={scrollAnchor ? "" : undefined}
      className={cn(
        // Rows stay in the DOM (selection, find-in-page, assistive tech),
        // but the browser skips painting the ones far off screen. This is
        // what keeps a 400-turn thread scrolling at the same speed as a
        // 20-turn one, without a virtualizer.
        "[content-visibility:auto] [contain-intrinsic-size:auto_140px]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function MessageScrollerButton({
  direction = "end",
  className,
  ...props
}: React.ComponentProps<"button"> & { direction?: "start" | "end" }) {
  const ctx = useMessageScrollerContext("MessageScrollerButton")
  const active = direction === "end" ? ctx.scrollable.end : ctx.scrollable.start

  return (
    <button
      type="button"
      data-slot="message-scroller-button"
      data-active={active ? "true" : "false"}
      // `inert` and out of the tab order while there is nothing that way,
      // so the control never adds an empty focus stop.
      inert={!active}
      aria-hidden={!active}
      onClick={() => {
        if (direction === "end") ctx.scrollToEnd({ behavior: "smooth" })
        else ctx.scrollToStart({ behavior: "smooth" })
      }}
      className={cn(
        "absolute bottom-4 left-1/2 z-10 inline-flex size-8 -translate-x-1/2 items-center justify-center",
        "rounded-full border border-border bg-background/95 text-muted-foreground shadow-md backdrop-blur-sm",
        "transition-opacity duration-150 hover:text-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        "data-[active=false]:pointer-events-none data-[active=false]:opacity-0",
        className,
      )}
      {...props}
    >
      {direction === "end" ? (
        <ArrowDown className="size-4" aria-hidden />
      ) : (
        <ArrowUp className="size-4" aria-hidden />
      )}
      <span className="sr-only">
        {direction === "end" ? "Scroll to end" : "Scroll to start"}
      </span>
    </button>
  )
}

/** Imperative control from anywhere under the provider (menus, search, permalinks). */
export function useMessageScroller() {
  const ctx = useMessageScrollerContext("useMessageScroller")
  return {
    scrollToMessage: ctx.scrollToMessage,
    scrollToEnd: ctx.scrollToEnd,
    scrollToStart: ctx.scrollToStart,
  }
}

/** Which edges can still be scrolled toward. `end === false` means at the bottom. */
export function useMessageScrollerScrollable(): ScrollState {
  const ctx = useMessageScrollerContext("useMessageScrollerScrollable")
  return ctx.scrollable
}
