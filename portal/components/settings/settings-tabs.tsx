"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * The tab strip, and the only client-side piece of the settings page.
 *
 * Two things the old markup got wrong, both of which look like layout bugs
 * and are not:
 *
 *   1. `defaultValue` only. Clicking a tab changed the panel and nothing
 *      else, so the address bar still said `?tab=plan` — refresh threw you
 *      back, and "copy this link" copied the wrong tab. `?tab=` is a
 *      documented entry point (the 402 in chat, the header key button), so
 *      the URL has to follow the click, not just lead it. `replace`, not
 *      `push`: seven tab clicks should not be seven Back presses.
 *
 *   2. Seven `flex-1` triggers in one `overflow-x-auto` strip. At 375px
 *      each got ~46px and every label past "Plan" was clipped mid-word with
 *      no scrollbar to say so. Wrapping to two rows shows all seven at any
 *      width and needs no scroll affordance at all.
 */
const TABS = [
  ["plan", "Plan"],
  ["usage", "Usage"],
  ["keys", "API keys"],
  ["billing", "Billing"],
  ["profile", "Profile"],
  ["ai", "AI"],
  ["danger", "Danger"],
] as const;

type Panel = { value: string; keepMounted?: boolean };

export function SettingsTabs({
  tab,
  children,
}: {
  tab: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Seeded from the URL, then owned locally so a click paints immediately
  // instead of waiting for the server render that `replace` triggers.
  const [value, setValue] = React.useState(tab);
  React.useEffect(() => setValue(tab), [tab]);

  // Panels unmount on switch unless `keepMounted` is set, which threw away
  // half-typed input (a name, a memory, a system prompt) the moment you
  // glanced at another tab. Keep every panel you have VISITED mounted —
  // not all seven up front, which would fire seven API reads on load for
  // six screens nobody asked for.
  const [seen, setSeen] = React.useState<ReadonlySet<string>>(() => new Set([tab]));
  React.useEffect(() => setSeen((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab))), [tab]);

  function change(next: string) {
    setValue(next);
    setSeen((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    const query = new URLSearchParams(params.toString());
    query.set("tab", next);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }

  return (
    <Tabs value={value} onValueChange={(next) => change(String(next))}>
      {/* Named, not decorative: the page can hold another tab strip (billing
          and usage both render their own), and an unnamed `role="tablist"`
          left a screen reader announcing two indistinguishable lists. */}
      <TabsList
        aria-label="Settings sections"
        // `group-data-[orientation=horizontal]:h-auto`, not plain `h-auto`:
        // the variant compiles two levels deep and outranks a bare height
        // utility, so the list stayed `h-8` and the wrapped second row of
        // tabs rendered outside its own background.
        className="mb-4 w-full flex-wrap justify-start gap-1 p-1 group-data-[orientation=horizontal]/tabs:h-auto sm:mb-6"
      >
        {TABS.map(([key, label]) => (
          <TabsTrigger
            key={key}
            value={key}
            className="h-8 flex-1 basis-20 px-2 text-[13px] sm:basis-0 sm:text-sm"
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement<Panel> (child)) return child;
        return seen.has(child.props.value) ? React.cloneElement(child, { keepMounted: true }) : child;
      })}
    </Tabs>
  );
}
