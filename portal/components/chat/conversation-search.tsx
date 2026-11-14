"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Conversation search.
 *
 * TWO MODES, ONE QUERY SOURCE:
 *
 *   INLINE   a filter box in the sidebar. Always visible, no shortcut, no
 *            modal: at 30 conversations this is what people reach for.
 *   PALETTE  ⌘K / Ctrl+K. Same results, keyboard-driven, so it doubles as
 *            navigation once a user has 200 chats.
 *
 * DEBOUNCED, AND THE RESPONSE ORDER IS NOT TRUSTED. Typing "refactor" fires
 * six requests; the answer to "ref" can land after the answer to "refactor"
 * and would overwrite the newer list with older results. The sequence
 * number prevents that.
 *
 * AN EMPTY QUERY IS NOT A REQUEST.
 */

export interface SearchHit {
  conversation_id: string;
  title: string;
  snippet: string;
  role: string;
  score: number;
  created_at: string | null;
}

const DEBOUNCE_MS = 180;

export function useConversationSearch(query: string) {
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [source, setSource] = React.useState<"engine" | "postgres" | "none">("none");
  const seq = React.useRef(0);

  React.useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/search?q=${encodeURIComponent(trimmed)}`, {
          cache: "no-store",
        });
        if (mine !== seq.current) return;
        if (!res.ok) {
          setHits([]);
          return;
        }
        const body = (await res.json()) as { hits?: SearchHit[]; source?: typeof source };
        if (mine !== seq.current) return;
        setHits(body.hits ?? []);
        setSource(body.source ?? "none");
      } catch {
        if (mine === seq.current) setHits([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  return { hits, searching, source };
}

export function SidebarConversations({
  list,
  onSearchShortcut,
}: {
  list: React.ReactNode;
  onSearchShortcut?: "⌘K" | "Ctrl K";
}) {
  const [query, setQuery] = React.useState("");
  const { hits, searching } = useConversationSearch(query);

  return (
    <div className="flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
      <div className="relative px-2 pt-2 pb-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground/70"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search conversations"
          className={cn(
            "h-9 w-full rounded-md border border-transparent bg-sidebar-accent/60 pr-9 pl-8 text-base sm:h-8 sm:text-[13px]",
            "outline-none transition-colors placeholder:text-muted-foreground/70",
            "hover:bg-sidebar-accent focus:bg-background focus-visible:ring-2 focus-visible:ring-ring",
            "[&::-webkit-search-cancel-button]:hidden",
          )}
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-3 size-auto -translate-y-1/2 p-1.5 text-muted-foreground sm:p-0.5"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </Button>
        ) : (
          onSearchShortcut && (
            <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] font-medium text-muted-foreground/50">
              {onSearchShortcut}
            </kbd>
          )
        )}
      </div>

      {query.trim() ? (
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <SearchResults hits={hits} searching={searching} query={query} />
        </div>
      ) : (
        list
      )}
    </div>
  );
}

/**
 * The results list, shared by the sidebar and the palette.
 *
 * KEYBOARD NAV IS ON A FOCUSABLE WRAPPER, NOT THE `<ul>`.
 *
 * The previous version put `onKeyDown` on the `<ul>` while focus stayed in
 * the input, so ArrowDown and Enter never fired — a palette advertised by a
 * keyboard shortcut was mouse-only. `active` is controlled by the caller
 * (which owns the input) and the list is focusable so it also works
 * standalone in the sidebar.
 */
export function SearchResults({
  hits,
  searching,
  query,
  onNavigate,
  compact,
  active: controlledActive,
  onActiveChange,
}: {
  hits: SearchHit[];
  searching: boolean;
  query: string;
  onNavigate?: () => void;
  compact?: boolean;
  /** Controlled highlight index, so the input's key handler can drive it. */
  active?: number;
  onActiveChange?: (index: number) => void;
}) {
  const router = useRouter();
  const [internalActive, setInternalActive] = React.useState(0);
  const active = controlledActive ?? internalActive;
  const setActive = onActiveChange ?? setInternalActive;

  React.useEffect(() => setActive(0), [hits, setActive]);

  if (!query.trim()) return null;

  if (searching && hits.length === 0) {
    return (
      <ul className="space-y-1 px-2 py-1" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-9 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </ul>
    );
  }

  if (hits.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        No chats match “{query.trim()}”.
      </p>
    );
  }

  function go(hit: SearchHit) {
    router.push(`/chat/${hit.conversation_id}`);
    onNavigate?.();
  }

  return (
    <ul
      className={cn("space-y-0.5 px-2 py-1", compact && "max-h-[60vh] overflow-y-auto")}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive(Math.min(active + 1, hits.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive(Math.max(active - 1, 0));
        } else if (e.key === "Enter" && hits[active]) {
          e.preventDefault();
          go(hits[active]);
        }
      }}
    >
      {hits.map((hit, i) => (
        <li key={`${hit.conversation_id}-${hit.created_at}-${i}`}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => go(hit)}
            onMouseEnter={() => setActive(i)}
            aria-current={i === active ? "true" : undefined}
            className="h-auto w-full flex-col items-stretch gap-0.5 rounded-lg px-2 py-1.5 text-left"
          >
            <span className="flex items-center gap-1.5 truncate text-[13px] font-medium">
              <MessageSquare className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              {hit.title || "Untitled"}
            </span>
            {/* The snippet is WHY it matched. Showing only the title makes
                two chats with the same name indistinguishable. */}
            <span className="line-clamp-2 pl-[18px] text-[11px] leading-snug text-muted-foreground">
              {hit.snippet}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The ⌘K palette.
 *
 * FOCUS STAYS IN THE INPUT; the input owns the arrow keys and Enter, and
 * drives the list's highlight index. That is the standard command-palette
 * model: the user never has to Tab from the field to the results, and the
 * results list is not a second focus trap.
 */
export function SearchPalette({ enabled = true }: { enabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const { hits, searching } = useConversationSearch(query);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const router = useRouter();

  React.useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isPaletteKey) return;
      event.preventDefault();
      setOpen((was) => {
        if (was) setQuery("");
        return !was;
      });
    }
    // The header's search button. ⌘K is the only trigger otherwise, and a
    // phone has no ⌘K — full-text search was unreachable on touch while the
    // sidebar's box only filters what is already listed.
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("chat:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("chat:search", onOpen);
    };
  }, [enabled]);

  React.useEffect(() => {
    if (open) {
      // Focus after paint: the input does not exist until the dialog
      // renders, and focusing a null ref is a no-op that leaves the palette
      // keyboard-dead.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  React.useEffect(() => setActive(0), [hits]);

  if (!open) return null;

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-2 pt-[6vh] backdrop-blur-[2px] sm:p-4 sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search conversations"
      onClick={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-[0_16px_48px_-12px_rgb(0_0_0/0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && hits[active]) {
                e.preventDefault();
                router.push(`/chat/${hits[active].conversation_id}`);
                close();
              }
            }}
            placeholder="Search your conversations…"
            aria-label="Search query"
            className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        {query.trim() ? (
          <SearchResults
            hits={hits}
            searching={searching}
            query={query}
            compact
            active={active}
            onActiveChange={setActive}
            onNavigate={close}
          />
        ) : (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Type to search message text across your chats.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * True when the platform uses ⌘ rather than Ctrl.
 *
 * RENDER-SAFE: the value is only known on the client, so this is read in an
 * effect and starts as `undefined`. Returning `navigator.platform` during
 * render produced "Ctrl K" on the server and "⌘K" on a Mac client, which is
 * a hydration text mismatch on every chat page.
 */
export function useShortcutLabel(): "⌘K" | "Ctrl K" | undefined {
  const [label, setLabel] = React.useState<"⌘K" | "Ctrl K" | undefined>(undefined);
  React.useEffect(() => {
    setLabel(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");
  }, []);
  return label;
}
