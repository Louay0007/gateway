/**
 * The two key states worth a badge.
 *
 * "Never used" and "unused 30d" are the only readings that change a
 * customer's decision (paste it, or revoke it). Everything else is a green
 * tick nobody reads, so a healthy key renders no badge at all.
 */
import { describe, it, expect } from "vitest";

import { keyHealth, STALE_DAYS } from "@/lib/dashboard/key-health";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("keyHealth", () => {
  it("flags a key minted a day ago and never used", () => {
    const h = keyHealth({ createdAt: daysAgo(2), lastUsedAt: null }, NOW);
    expect(h.state).toBe("never-used");
    expect(h.label).toBe("Never used");
    expect(h.hint).toContain("revoked");
  });

  it("leaves a freshly minted key alone", () => {
    // Opening the keys page right after creating one must not shout.
    const h = keyHealth({ createdAt: daysAgo(0.2), lastUsedAt: null }, NOW);
    expect(h.state).toBe("healthy");
    expect(h.label).toBeNull();
  });

  it("flags a key unused for the stale window", () => {
    const h = keyHealth({ createdAt: daysAgo(90), lastUsedAt: daysAgo(STALE_DAYS) }, NOW);
    expect(h.state).toBe("stale");
    expect(h.label).toBe(`Unused ${STALE_DAYS}d`);
  });

  it("does not flag a key used inside the window", () => {
    const h = keyHealth({ createdAt: daysAgo(90), lastUsedAt: daysAgo(STALE_DAYS - 1) }, NOW);
    expect(h.state).toBe("healthy");
    expect(h.label).toBeNull();
  });

  it("is quiet about a key used recently", () => {
    const h = keyHealth({ createdAt: daysAgo(5), lastUsedAt: daysAgo(0.5) }, NOW);
    expect(h.state).toBe("healthy");
  });

  it("does not crash on an unparseable timestamp", () => {
    const h = keyHealth({ createdAt: daysAgo(2), lastUsedAt: "not-a-date" }, NOW);
    expect(h.state).toBe("healthy");
  });
});
