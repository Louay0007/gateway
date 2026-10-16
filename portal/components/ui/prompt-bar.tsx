"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  Square,
} from "lucide-react";

/** One selectable model. Colors match the Session card dots. */
export interface BarModel {
  value: string;
  label: string;
  color: string;
}

type PanelId = "model" | null;

export interface PromptBarProps {
  placeholder?: string;
  onSubmit?: (value: string) => void;
  /** While true, the send button becomes Stop and the glow goes bright. */
  streaming?: boolean;
  onStop?: () => void;
  /** Controlled model picker — the single source of truth lives in the parent. */
  model?: string;
  models?: BarModel[];
  onModelChange?: (value: string) => void;
  className?: string;
}

export default function PromptBar({
  placeholder = "Say hello to your model",
  onSubmit,
  streaming = false,
  onStop,
  model,
  models = [],
  onModelChange,
  className,
}: PromptBarProps) {
  const [value, setValue] = useState("");
  const [openPanel, setOpenPanel] = useState<PanelId>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const active = models.find((m) => m.value === model) ?? models[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Auto-grow the textarea; shrink back after send.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const togglePanel = () =>
    setOpenPanel((current) => (current === "model" ? null : "model"));

  const canSend = value.trim().length > 0 && !streaming;

  const handleSubmit = () => {
    if (!canSend) return;
    onSubmit?.(value.trim());
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter keeps a newline — the chat convention.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      ref={rootRef}
      className={[
        "relative w-full max-w-[620px] overflow-hidden rounded-[24px] p-[2px]",
        className ?? "",
      ].join(" ")}
    >
      <style>{`
        .pb-glow-layer {
          position: absolute;
          inset: -60%;
          background: conic-gradient(from 0deg,
            transparent 0deg, transparent 295deg,
            color-mix(in srgb, var(--pb-arc, #ffffff) 55%, transparent) 308deg,
            var(--pb-arc, #ffffff) 325deg,
            color-mix(in srgb, var(--pb-arc, #ffffff) 55%, transparent) 342deg,
            transparent 355deg, transparent 360deg);
          animation: pb-spin 7s linear infinite;
          opacity: 0.45;
          transition: opacity 0.4s ease;
          pointer-events: none;
        }
        .pb-glow-streaming {
          opacity: 1;
          animation-duration: 2.2s;
        }
        @keyframes pb-spin {
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pb-glow-layer { animation: none; }
        }
      `}</style>

      {/*
        The travelling light. The OLD implementation animated a @property
        custom angle inside the gradient — which silently does nothing in
        any engine that hasn't shipped @property, leaving a frozen arc (or
        no visible light at all). This one rotates a real layer with a plain
        transform animation, which every browser runs; only the 2px padding
        ring lets it show through. --pb-arc tints the arc with the active
        model's color so the light always matches the selected tier.
      */}
      <div
        aria-hidden="true"
        style={{ ["--pb-arc" as string]: active?.color ?? "#ffffff" }}
        className={["pb-glow-layer", streaming ? "pb-glow-streaming" : ""].join(" ")}
      />

      <div className="relative rounded-[22px] bg-muted p-5 pb-4">
        <textarea
          ref={areaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          aria-label={placeholder}
          disabled={streaming}
          className="mb-4 block max-h-[200px] w-full resize-none bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
        />

        <div className="flex items-center justify-between gap-2">
          <div className="relative">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={openPanel === "model"}
              aria-label="Select model"
              onClick={togglePanel}
              disabled={streaming || models.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {active && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: active.color }}
                  aria-hidden="true"
                />
              )}
              {active?.label ?? "Model"}
              <ChevronDown size={15} />
            </button>
            {openPanel === "model" && (
              <div
                role="listbox"
                aria-label="Model"
                className="absolute bottom-11 left-0 z-10 min-w-[160px] rounded-2xl bg-popover p-1.5 shadow-lg ring-1 ring-border"
              >
                {models.map((m) => (
                  <ModelItem
                    key={m.value}
                    color={m.color}
                    label={m.label}
                    selected={m.value === active?.value}
                    onClick={() => {
                      onModelChange?.(m.value);
                      setOpenPanel(null);
                      areaRef.current?.focus();
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {streaming ? (
            <button
              type="button"
              aria-label="Stop generating"
              onClick={onStop}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send message"
              onClick={handleSubmit}
              disabled={!canSend}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/15 text-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-foreground enabled:hover:text-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelItem({
  color,
  label,
  onClick,
  selected,
}: {
  color: string;
  label: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
      {selected && <span className="ml-auto text-xs opacity-60">✓</span>}
    </button>
  );
}

