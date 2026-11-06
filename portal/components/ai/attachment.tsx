"use client"

import * as React from "react"
import { cn } from "cn"
import { FileText, Image as ImageIcon, Loader2, Table2, X } from "lucide-react"
import { MAX_ATTACHMENTS } from "@/lib/chat/attachments"

/**
 * Attachment — the chip row and the attach control.
 *
 * THREE STATES, EACH VISIBLE rather than implied:
 *
 *   UPLOADING  the chip appears immediately with a spinner. The file is
 *              parsed server-side, and a control that does nothing for two
 *              seconds gets double-clicked.
 *   READY      name, kind icon, extracted size — so the user can see the
 *              document was READ, not merely attached.
 *   FAILED     the reason, on the chip, with a dismiss. A failure that only
 *              reaches the console is a file that silently does not exist.
 *
 * PASTE, DROP AND PICK ARE ONE PATH. All three funnel through `onAdd`, so
 * the "what is a valid file" check lives in exactly one place. Splitting it
 * is how a paste ends up bypassing the size limit.
 *
 * FILES ARE NOT SENT FROM HERE. They go to POST /api/attachments, which
 * parses once and stores the text; the turn then carries only ids.
 */

export interface AttachmentChip {
  localId: string
  status: "uploading" | "ready" | "error"
  filename: string
  id?: string
  kind?: string
  chars?: number
  truncated?: boolean
  error?: string
}

/**
 * Re-exported from the policy module rather than restated: a second copy is
 * how the picker came to offer formats the route refused. The server is
 * still the only check — `accept` is a filter a user can switch off.
 */
export { ACCEPT_ATTRIBUTE as ACCEPT_EXTENSIONS, MAX_ATTACHMENTS as MAX_FILES } from "@/lib/chat/attachments"

export function AttachmentRow({
  chips,
  onRemove,
  className,
  ...props
}: React.ComponentProps<"ul"> & {
  chips: AttachmentChip[]
  onRemove: (localId: string) => void
}) {
  if (chips.length === 0) return null
  return (
    <ul
      data-slot="attachment-row"
      aria-label="Attached files"
      className={cn("flex flex-wrap gap-1.5 px-3 pb-1.5", className)}
      {...props}
    >
      {chips.map((chip) => (
        <li key={chip.localId}>
          <div
            className={cn(
              "group flex max-w-[240px] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
              chip.status === "error"
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : "border-border bg-muted/50",
            )}
            title={chip.error ?? chip.filename}
          >
            <KindIcon kind={chip.kind} filename={chip.filename} />
            <span className="truncate font-medium">{chip.filename}</span>
            {chip.status === "uploading" && (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-label="Uploading" />
            )}
            {chip.status === "ready" && chip.chars !== undefined && (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatChars(chip.chars)}
                {chip.truncated ? " (cut)" : ""}
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(chip.localId)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label={`Remove ${chip.filename}`}
            >
              <X className="size-3" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function KindIcon({ kind, filename }: { kind?: string; filename: string }) {
  const resolved = kind ?? guessKind(filename)
  const cls = "size-3.5 shrink-0 text-muted-foreground"
  if (resolved === "image") return <ImageIcon className={cls} aria-hidden />
  if (resolved === "sheet") return <Table2 className={cls} aria-hidden />
  return <FileText className={cls} aria-hidden />
}

export function guessKind(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image"
  if (["xlsx", "xls", "csv", "tsv"].includes(ext)) return "sheet"
  return "text"
}

/** Same units as the server's prompt notice, so the two never disagree. */
export function formatChars(chars: number): string {
  if (chars < 1000) return `${chars}`
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(0)}k`
  return `${(chars / 1_000_000).toFixed(1)}M`
}
