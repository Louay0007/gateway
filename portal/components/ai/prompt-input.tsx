"use client"

import * as React from "react"
import { cn } from "cn"
import { ArrowUp, Plus, Square } from "lucide-react"
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group"
import { ACCEPT_ATTRIBUTE, MAX_ATTACHMENTS } from "@/lib/chat/attachments"

/**
 * Prompt Input — the composer.
 *
 * ONE BORDER, ONE SEND. The field is a single rounded surface: the textarea
 * occupies the top, attachments sit between, and a footer row holds the
 * tools on the left and exactly one submit on the right. The border belongs
 * to the GROUP, never to the textarea or the rows inside it, which is what
 * makes it read as one control instead of a box with a toolbar bolted to
 * its edge.
 *
 * THE SUBMIT IS THE ONLY FILLED CONTROL. Everything else in the footer is
 * quiet (ghost buttons, muted text). A composer with two competing primary
 * actions is the specific failure this replaces: a filled attach button on
 * the left read as a second send, so the important control stopped being
 * findable by shape.
 *
 * ENTER SENDS, SHIFT+ENTER BREAKS, IME IS EXCLUDED. Composing Japanese and
 * pressing Enter to accept a candidate must not fire a send; `isComposing`
 * plus the composition handlers are what prevent it.
 *
 * STOP IS THE SAME BUTTON, morphing in place. While a stream is open a
 * second send is impossible, so the primary action becomes the only other
 * thing the user can want.
 */
export function PromptInput({
  onSend,
  onStop,
  onAttach,
  streaming,
  disabled,
  placeholder,
  tools,
  attach,
  attachments,
  draft,
  onDraftChange,
  busy,
  className,
}: {
  onSend: (text: string) => void
  onStop: () => void
  /** Files pasted from the clipboard, routed to the same intake as a drop. */
  onAttach?: (files: File[]) => void
  streaming: boolean
  disabled?: boolean
  placeholder?: string
  tools?: React.ReactNode
  /** The quiet "+" affordance. Rendered as a ghost control, never filled. */
  attach?: React.ReactNode
  attachments?: React.ReactNode
  draft?: string
  onDraftChange?: (text: string) => void
  /**
   * An upload is in flight. Shows a quiet status line; deliberately does NOT
   * disable submit. The server drops ids it cannot resolve and the chip
   * stays visible, so holding the typed sentence hostage helps nobody.
   */
  busy?: boolean
  className?: string
}) {
  const [internal, setInternal] = React.useState("")
  const value = draft ?? internal
  const setValue = (next: string) => {
    if (draft === undefined) setInternal(next)
    onDraftChange?.(next)
  }

  const ref = React.useRef<HTMLTextAreaElement>(null)
  const composing = React.useRef(false)

  // Drop target: the whole composer, not the "+" button.
  //
  // A 28px circle was the only drop target, which asked the user to hit it
  // exactly. Files are dragged onto the writing area by habit, so the target
  // is the composer surface and the ring reports the state.
  //
  // `dragenter`/`dragleave` are counted rather than toggled: dragging over a
  // child fires `dragleave` on the parent, so a boolean flickers off mid-drag
  // on every child boundary. A depth counter returns to zero only when the
  // pointer really leaves.
  const [dropping, setDropping] = React.useState(false)
  const dragDepth = React.useRef(0)

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files")

  function resetDrag() {
    dragDepth.current = 0
    setDropping(false)
  }

  // Autosize. Reset to `auto` first, or the box can only ever grow.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 12 * 24)}px`
  }, [value])

  // A seeded draft lands the caret at the end, ready to continue typing.
  React.useEffect(() => {
    if (!draft) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [draft])

  function submit() {
    const text = value.trim()
    if (!text || streaming || disabled) return
    onSend(text)
    setValue("")
  }

  const canSend = value.trim().length > 0 && !streaming && !disabled

  return (
    <div
      className={cn("relative w-full px-4 pb-4", className)}
      onDragEnter={(e) => {
        if (!onAttach || disabled || streaming || !hasFiles(e)) return
        e.preventDefault()
        dragDepth.current += 1
        setDropping(true)
      }}
      onDragOver={(e) => {
        if (!onAttach || disabled || streaming || !hasFiles(e)) return
        // Without this the browser navigates to the file on drop.
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDropping(false)
      }}
      onDrop={(e) => {
        resetDrag()
        if (!onAttach || disabled || streaming) return
        e.preventDefault()
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) onAttach(files)
      }}
    >
      <form
        className="mx-auto w-full max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <InputGroup
          className={cn(
            // A soft, tall surface: this is a writing area, not a form field.
            "rounded-[26px] border-border/70 bg-background/70 shadow-sm backdrop-blur",
            "transition-[border-color,box-shadow] duration-200",
            // FOCUS IS A BORDER SHIFT, NOT A RING.
            //
            // The shared InputGroup adds `ring-[3px]` plus `border-ring` on
            // focus-within. A 3px translucent ring sitting OUTSIDE a 1px
            // border renders as two concentric outlines — the "doubled
            // border" that made this composer look broken the moment the
            // caret landed in it. Neutralising both here (cn's tailwind-merge
            // lets a later class win) leaves one crisp edge plus a soft glow.
            "focus-within:border-foreground/25 focus-within:ring-0",
            // A drop shadow only — no 1px halo. A halo IS a second outline,
            // so keeping it would reintroduce the exact artefact this fixes.
            "focus-within:shadow-[0_10px_30px_-14px_rgb(0_0_0/0.40)]",
            // The drop state is an inset ring on the field itself, so the
            // target is visibly the whole writing area rather than its corner.
            dropping && "border-foreground/40 ring-2 ring-foreground/15",
          )}
        >
          {/* Overlay, not a sibling row: InputGroup is `flex-col`, so an
              absolutely positioned child still needs its inset anchored by a
              `relative` ancestor and `inset-0` to mean the field. Without
              `absolute` it took a row of its own and pushed the footer down. */}
          {dropping ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[26px] border border-dashed border-foreground/25 bg-background/85"
            >
              <span className="text-sm font-medium text-foreground">Drop to attach</span>
            </div>
          ) : null}
          <InputGroupTextarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? [])
              if (files.length === 0 || !onAttach || disabled) return
              // Only swallow the paste when there are real files; a text
              // paste must reach the textarea untouched.
              e.preventDefault()
              onAttach(files)
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              if (e.shiftKey) return
              if (e.nativeEvent.isComposing || composing.current) return
              e.preventDefault()
              submit()
            }}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            rows={1}
            placeholder={placeholder ?? "What would you like to know?"}
            aria-label="Message"
            className={cn(
              "min-h-[52px] px-5 pt-4 pb-2 text-[15px] leading-relaxed",
              "placeholder:text-muted-foreground/70",
            )}
          />

          {attachments}

          {/*
            THE FOOTER: tools left, submit right, one row, items centred.
            `items-center` (not `items-end`) keeps every control on one
            optical line whether or not the textarea has grown.
          */}
          <div className="flex items-center gap-2 px-2.5 pb-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {attach}
              {tools}
            </div>

            {busy ? (
              <span
                className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums"
                role="status"
              >
                uploading…
              </span>
            ) : null}

            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  "bg-foreground text-background transition-colors hover:opacity-90",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                )}
              >
                <Square className="size-3 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  "bg-foreground text-background transition-all duration-150",
                  "hover:opacity-90 active:scale-95",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  // Empty field: the control recedes to a hint rather than
                  // sitting there as a dead filled circle.
                  "disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground/50",
                )}
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </InputGroup>
      </form>
    </div>
  )
}

/**
 * AttachControl — the "+" affordance.
 *
 * A ghost button, not a filled circle: the only filled control in the
 * composer is Send. Drag-and-drop and paste both route through `onAdd`, so
 * all three intake paths share one validator.
 */
export function AttachControl({
  onAdd,
  disabled,
  count = 0,
  max = MAX_ATTACHMENTS,
}: {
  onAdd: (files: File[]) => void
  disabled?: boolean
  count?: number
  max?: number
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const remaining = max - count

  function pick(files: FileList | null) {
    if (!files || files.length === 0) return
    onAdd(Array.from(files).slice(0, Math.max(remaining, 0)))
  }

  return (
    <div
      className={cn(
        "relative flex items-center rounded-full",
        dragging && "ring-2 ring-ring/50",
      )}
      onDragOver={(e) => {
        if (disabled) return
        if (!Array.from(e.dataTransfer.types).includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (disabled) return
        e.preventDefault()
        setDragging(false)
        pick(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files)
          // Reset so picking the same file twice still fires a change.
          e.target.value = ""
        }}
        aria-label="Attach files"
      />
      <button
        type="button"
        disabled={disabled || remaining <= 0}
        onClick={() => inputRef.current?.click()}
        title={remaining <= 0 ? `Up to ${max} files per message` : "Attach files"}
        aria-label="Attach files"
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-full text-muted-foreground",
          "transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
