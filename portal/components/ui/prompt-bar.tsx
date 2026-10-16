"use client";

import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Slash,
  LayoutGrid,
  Palette,
  ChevronDown,
  Mic,
  ArrowUp,
  File,
  Image as ImageIcon,
  Search,
  Code,
  List,
  LayoutTemplate,
  Zap,
  Scale,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";

type Mode = "Rapide" | "Équilibré" | "Réfléchi";
type PanelId = "add" | "tools" | "layout" | "color" | "mode" | null;

export interface PromptBarProps {
  placeholder?: string;
  onSubmit?: (value: string) => void;
  className?: string;
}

const modeIcons: Record<Mode, LucideIcon> = {
  Rapide: Zap,
  Équilibré: Scale,
  Réfléchi: Lightbulb,
};

const accentColors = ["#3a3a3f", "#5c8dff", "#ff7a5c", "#4fd1a5", "#c98bff"];

export default function PromptBar({
  placeholder = "Que souhaitez-vous modifier ou créer ?",
  onSubmit,
  className,
}: PromptBarProps) {
  const [value, setValue] = useState("");
  const [openPanel, setOpenPanel] = useState<PanelId>(null);
  const [mode, setMode] = useState<Mode>("Équilibré");
  const [recording, setRecording] = useState(false);
  const [accent, setAccent] = useState(accentColors[0]);
  const [sending, setSending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const togglePanel = (id: PanelId) =>
    setOpenPanel((current) => (current === id ? null : id));

  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit?.(value.trim());
    setSending(true);
    setTimeout(() => setSending(false), 350);
  };

  const ModeIcon = modeIcons[mode];

  return (
    <div
      ref={rootRef}
      className={[
        "prompt-bar-glow relative w-full max-w-[620px] rounded-[24px] bg-muted p-[2px]",
        className ?? "",
      ].join(" ")}
    >
      <style>{`
        @property --pb-angle {
          syntax: '<angle>';
          inherits: false;
          initial-value: 0deg;
        }
        .prompt-bar-glow {
          --pb-angle: 0deg;
          background-image:
            conic-gradient(from var(--pb-angle),
              transparent 0deg, transparent 295deg,
              #1a1a1a 308deg, #ffffff 325deg, #1a1a1a 342deg,
              transparent 355deg, transparent 360deg);
          animation: pb-rotate 7s linear infinite;
        }
        @keyframes pb-rotate {
          to { --pb-angle: 360deg; }
        }
        @keyframes pb-mic-pulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
          100% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
        }
      `}</style>

      <div className="rounded-[22px] bg-muted p-5 pb-4">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          rows={1}
          aria-label={placeholder}
          className="mb-6 w-full resize-none bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                aria-label="Ajouter des fichiers"
                aria-expanded={openPanel === "add"}
                onClick={() => togglePanel("add")}
                className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus size={20} />
              </button>
              {openPanel === "add" && (
                <div className="absolute left-0 top-11 z-10 min-w-[180px] rounded-2xl bg-popover p-1.5 shadow-lg ring-1 ring-border">
                  <MenuItem icon={File} label="Importer un fichier" onClick={() => setOpenPanel(null)} />
                  <MenuItem icon={ImageIcon} label="Importer une image" onClick={() => setOpenPanel(null)} />
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-label="Outils"
                aria-expanded={openPanel === "tools"}
                onClick={() => togglePanel("tools")}
                className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Slash size={18} />
              </button>
              {openPanel === "tools" && (
                <div className="absolute left-0 top-11 z-10 min-w-[190px] rounded-2xl bg-popover p-1.5 shadow-lg ring-1 ring-border">
                  <MenuItem icon={Search} label="Recherche web" onClick={() => setOpenPanel(null)} />
                  <MenuItem icon={ImageIcon} label="Générer une image" onClick={() => setOpenPanel(null)} />
                  <MenuItem icon={Code} label="Analyser du code" onClick={() => setOpenPanel(null)} />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                aria-label="Disposition"
                aria-expanded={openPanel === "layout"}
                onClick={() => togglePanel("layout")}
                className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LayoutGrid size={18} />
              </button>
              {openPanel === "layout" && (
                <div className="absolute right-0 top-11 z-10 min-w-[170px] rounded-2xl bg-popover p-1.5 shadow-lg ring-1 ring-border">
                  <MenuItem icon={List} label="Vue compacte" onClick={() => setOpenPanel(null)} />
                  <MenuItem icon={LayoutTemplate} label="Vue large" onClick={() => setOpenPanel(null)} />
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-label="Palette de couleurs"
                aria-expanded={openPanel === "color"}
                onClick={() => togglePanel("color")}
                className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Palette size={18} />
              </button>
              {openPanel === "color" && (
                <div className="absolute right-0 top-11 z-10 flex gap-2 rounded-2xl bg-popover p-2.5 shadow-lg ring-1 ring-border">
                  {accentColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Choisir la couleur ${c}`}
                      aria-pressed={accent === c}
                      onClick={() => setAccent(c)}
                      style={{ background: c }}
                      className={[
                        "h-5 w-5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        accent === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-popover" : "",
                      ].join(" ")}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={openPanel === "mode"}
                onClick={() => togglePanel("mode")}
                className="mx-1 flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ModeIcon size={14} />
                {mode}
                <ChevronDown size={15} />
              </button>
              {openPanel === "mode" && (
                <div role="listbox" className="absolute right-0 top-11 z-10 min-w-[160px] rounded-2xl bg-popover p-1.5 shadow-lg ring-1 ring-border">
                  {(Object.keys(modeIcons) as Mode[]).map((m) => {
                    const Icon = modeIcons[m];
                    return (
                      <MenuItem
                        key={m}
                        icon={Icon}
                        label={m}
                        selected={m === mode}
                        onClick={() => {
                          setMode(m);
                          setOpenPanel(null);
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              aria-label="Micro"
              aria-pressed={recording}
              onClick={() => setRecording((r) => !r)}
              className={[
                "flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                recording
                  ? "text-destructive bg-destructive/10 [animation:pb-mic-pulse_1.2s_ease-out_infinite]"
                  : "text-foreground hover:bg-foreground/10",
              ].join(" ")}
            >
              <Mic size={18} />
            </button>

            <button
              type="button"
              aria-label="Envoyer"
              onClick={handleSubmit}
              className={[
                "flex h-9 w-9 items-center justify-center rounded-full bg-foreground/15 text-foreground transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                sending ? "scale-90" : "scale-100",
              ].join(" ")}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  selected,
}: {
  icon: LucideIcon;
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
      <Icon size={16} />
      {label}
    </button>
  );
}