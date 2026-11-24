/**
 * One implementation of "last N days".
 *
 * The bug this prevents: the table, the chart and the CSV each computed the
 * window separately, so a fix to one left the export describing a different
 * range than the screen — discovered while reconciling a bill.
 */
import { describe, it, expect } from "vitest";

import { usageWindowFor } from "@/lib/dashboard/use-usage-window";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const DAY = 86_400_000;

describe("usageWindowFor", () => {
  it("spans exactly N days back from now", () => {
    const w = usageWindowFor("7", NOW);
    expect(w.days).toBe(7);
    expect(w.to.getTime() - w.from.getTime()).toBe(7 * DAY);
    expect(w.toIso).toBe(NOW.toISOString());
    expect(w.fromIso).toBe(new Date(NOW.getTime() - 7 * DAY).toISOString());
  });

  it("defaults to 30 for absent or unparseable ranges", () => {
    expect(usageWindowFor(undefined, NOW).days).toBe(30);
    expect(usageWindowFor(null, NOW).days).toBe(30);
    expect(usageWindowFor("", NOW).days).toBe(30);
    expect(usageWindowFor("abc", NOW).days).toBe(30);
    expect(usageWindowFor("0", NOW).days).toBe(30);
    expect(usageWindowFor("-7", NOW).days).toBe(30);
  });

  it("accepts numbers as well as strings", () => {
    expect(usageWindowFor(90, NOW).days).toBe(90);
  });

  it("floors fractional days so from/to never drift by hours", () => {
    const w = usageWindowFor("7.9", NOW);
    expect(w.days).toBe(7);
    expect(w.to.getTime() - w.from.getTime()).toBe(7 * DAY);
  });
});
