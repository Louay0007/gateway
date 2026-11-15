"use client";

import * as React from "react";
import { ExternalLink, PanelRightOpen, Wrench, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ai/markdown";
import { PreviewFrame } from "@/components/chat/preview-frame";
import { canRenderNow, type PreviewBlock } from "@/lib/chat/artifacts";
import { standaloneDocument } from "@/lib/chat/preview-template";

/**
 * The preview column. Plan §5.
 *
 * RENDERS NOTHING when there is no previewable block, so the transcript is
 * byte-identical to what it was before this feature for every ordinary
 * reply. That is deliberate: a panel that appears for a two-line snippet is
 * a panel the user learns to close without reading.
 *
 * THE HEADER IS THE CONTRACT: what this is (filename), what state it is in,
 * and the actions. Each action carries a label, not an icon alone.
 */

export interface PreviewPanelProps {
  blocks: PreviewBlock[];
  /** Still receiving tokens. */
  streaming: boolean;
  onClose: () => void;
  /** Prefills the composer with an error, so one click retries. */
  onFixWithClaude?: (message: string) => void;
  className?: string;
}

/**
 * A JSON block as readable, indented text.
 *
 * NOT a collapsible tree: re-formatting already fails on a partial document
 * (the normal state while streaming), and a tree is a component with its own
 * state that buys nothing at these sizes.
 */
function JsonView({ raw }: { raw: string }) {
  const pretty = React.useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // Mid-stream: show what arrived rather than an error the user cannot
      // act on. The header already says "Building…".
      return raw;
    }
  }, [raw]);
  return (
    <pre className="text-xs leading-relaxed whitespace-pre-wrap text-foreground">
      <code>{pretty}</code>
    </pre>
  );
}

/**
 * Minimal RFC-4180-aware split: handles "quoted, fields" and "" escapes.
 *
 * A real CSV parser is a dependency, and the blocks that reach here are
 * model-generated data rather than exports with embedded newlines. Anything
 * stranger than the common case renders as text, which is honest.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}

function CsvView({ raw }: { raw: string }) {
  const rows = React.useMemo(
    () =>
      raw
        .trim()
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map(splitCsvLine),
    [raw],
  );

  if (rows.length === 0) return null;
  const [head, ...body] = rows;

  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead>
        <tr className="border-b border-border">
          {head!.map((cell, i) => (
            <th key={i} scope="col" className="px-2 py-1.5 font-medium text-foreground">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, r) => (
          <tr key={r} className="border-b border-border/50">
            {row.map((cell, c) => (
              <td key={c} className="px-2 py-1.5 text-muted-foreground">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Everything that is not an iframe.
 *
 * `Markdown` is reused for svg/markdown/mermaid so there is ONE markdown
 * renderer and ONE themed mermaid plugin in the product. A second,
 * differently-configured copy here is how two surfaces drift.
 */
function PreviewBody({ block, streaming }: { block: PreviewBlock; streaming: boolean }) {
  if (block.kind === "json") {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <JsonView raw={block.content} />
      </div>
    );
  }
  if (block.kind === "csv") {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <CsvView raw={block.content} />
      </div>
    );
  }
  // svg | markdown | mermaid — all through the existing renderer.
  const fenceLang = block.kind === "markdown" ? "markdown" : block.kind;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <Markdown streaming={streaming}>
        {"```" + fenceLang + "\n" + block.content + "\n```"}
      </Markdown>
    </div>
  );
}

export function PreviewPanel({
  blocks,
  streaming,
  onClose,
  onFixWithClaude,
  className,
}: PreviewPanelProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // The active tab follows the newest block unless the user picked one: a
  // second block appearing mid-stream must not yank them off the one they
  // are reading.
  const selected = blocks.find((b) => b.id === activeId) ?? blocks[blocks.length - 1] ?? null;

  // A new block id resets the error — it belonged to the previous document.
  const lastId = selected?.id;
  React.useEffect(() => {
    setError(null);
  }, [lastId]);

  if (!selected) return null;

  // `mermaid` waits for its closing fence; everything else renders live.
  const renderable = canRenderNow(selected);
  const state: "streaming" | "ready" = streaming && !selected.closed ? "streaming" : "ready";

  const openInTab = () => {
    // A tab cannot carry the iframe sandbox attribute, so this is strictly
    // weaker than the panel — but the CSP's `connect-src 'none'` still
    // holds, which is the control that stops exfiltration. Documented in
    // preview-template.ts rather than assumed.
    const blob = new Blob([standaloneDocument(selected.content)], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) toast.error("The browser blocked the new tab.");
    // Revoked after the tab has loaded; an immediate revoke leaves a blank
    // tab in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <aside
      aria-label="Preview"
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-l border-border/60 bg-background",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="truncate text-xs font-medium text-foreground" title={selected.filename}>
          {selected.filename}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {error ? "Error" : state === "streaming" ? "Building…" : "Ready"}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {error && onFixWithClaude ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={() => onFixWithClaude(error)}
            >
              <Wrench className="size-3.5" aria-hidden />
              Fix with Claude
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={openInTab}
            aria-label="Open preview in a new tab"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {blocks.length > 1 ? (
        <div
          role="tablist"
          aria-label="Preview blocks"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5"
        >
          {blocks.map((b) => (
            <Button
              key={b.id}
              type="button"
              role="tab"
              variant="ghost"
              size="sm"
              aria-selected={b.id === selected.id}
              onClick={() => setActiveId(b.id)}
              className={cn(
                "h-7 shrink-0 rounded-md px-2 text-[11px]",
                b.id === selected.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {b.filename}
            </Button>
          ))}
        </div>
      ) : null}

      {!renderable ? (
        // mermaid mid-stream: the source, not a parse error that vanishes.
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <p className="mb-2 text-xs text-muted-foreground">
            Waiting for the diagram to finish before rendering.
          </p>
          <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{selected.content}</pre>
        </div>
      ) : selected.kind === "html" ? (
        <PreviewFrame
          html={selected.content}
          title={selected.filename}
          state={error ? "error" : state}
          errorMessage={error}
        />
      ) : (
        <PreviewBody block={selected} streaming={state === "streaming"} />
      )}
    </aside>
  );
}

/**
 * The way back in.
 *
 * The collapse control lives in the transcript header, not in the panel: a
 * panel that hides itself cannot offer the way to reopen it.
 */
export function PreviewOpenButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("gap-1.5 text-xs", className)}
    >
      <PanelRightOpen className="size-4" aria-hidden />
      Preview
    </Button>
  );
}
