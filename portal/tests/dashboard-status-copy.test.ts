/**
 * The sentence at the top of the Overview, for every tone.
 *
 * The dashboard's job is to answer "am I about to run out?" in one line.
 * This asserts the line, the tone and the action for each state, plus the
 * two places pluralisation and missing dates go wrong.
 */
import { describe, it, expect } from "vitest";

import { statusCopy } from "@/lib/dashboard/status-copy";

const LIMIT = 50_000_000;
const RESETS = "15 December";

describe("statusCopy", () => {
  it("healthy: names what is left and when it resets", () => {
    const c = statusCopy({
      poolTokens: LIMIT,
      poolUsedTokens: 0,
      resets: RESETS,
      daysLeft: null,
    });
    expect(c.tone).toBe("healthy");
    expect(c.headline).toBe("50M of 50M left");
    expect(c.detail).toBe("resets 15 December");
    expect(c.cta).toBeNull();
  });

  it("watching: leads with the percentage and the days at this rate", () => {
    const c = statusCopy({
      poolTokens: LIMIT,
      poolUsedTokens: LIMIT * 0.87,
      resets: RESETS,
      daysLeft: 4,
    });
    expect(c.tone).toBe("watching");
    expect(c.headline).toBe("87% used — 6.5M left");
    expect(c.detail).toBe("about 4 days left at this rate");
    expect(c.cta?.label).toBe("Add tokens");
  });

  it("watching: singular day, and falls back to the reset date", () => {
    const c = statusCopy({
      poolTokens: LIMIT,
      poolUsedTokens: LIMIT * 0.9,
      resets: RESETS,
      daysLeft: 1,
    });
    expect(c.detail).toBe("about 1 day left at this rate");

    const noRate = statusCopy({
      poolTokens: LIMIT,
      poolUsedTokens: LIMIT * 0.9,
      resets: RESETS,
      daysLeft: null,
    });
    expect(noRate.detail).toBe("resets 15 December");
  });

  it("warning: upgrades rather than adding tokens", () => {
    const c = statusCopy({
      poolTokens: LIMIT,
      poolUsedTokens: LIMIT * 0.96,
      resets: RESETS,
      daysLeft: 0,
    });
    expect(c.tone).toBe("warning");
    expect(c.cta?.label).toBe("Upgrade");
  });

  it("blocked: says paused until renewal, never 'tomorrow'", () => {
    const c = statusCopy({
      poolTokens: LIMIT,
      poolUsedTokens: LIMIT,
      resets: RESETS,
      daysLeft: 0,
    });
    expect(c.tone).toBe("blocked");
    expect(c.headline).toBe("Out of tokens for this period");
    expect(c.detail).toBe("Every model is paused until renewal on 15 December.");
    expect(c.detail).not.toMatch(/tomorrow|midnight/i);
    expect(c.cta?.label).toBe("Upgrade");
  });

  it("blocked: still reads correctly with no period end", () => {
    const c = statusCopy({
      poolTokens: LIMIT,
      poolUsedTokens: LIMIT + 1,
      resets: null,
      daysLeft: null,
    });
    expect(c.detail).toBe("Every model is paused until renewal.");
  });

  it("unlimited: says there is no cap instead of showing a fake limit", () => {
    const c = statusCopy({
      poolTokens: null,
      poolUsedTokens: 12_345,
      resets: RESETS,
      daysLeft: null,
    });
    expect(c.tone).toBe("unlimited");
    expect(c.headline).toBe("No token cap on this plan");
    expect(c.cta).toBeNull();

    const zero = statusCopy({
      poolTokens: 0,
      poolUsedTokens: 1,
      resets: null,
      daysLeft: null,
    });
    expect(zero.tone).toBe("unlimited");
    expect(zero.detail).toBeNull();
  });

  it("no plan: points at the next step", () => {
    const c = statusCopy({
      poolTokens: 0,
      poolUsedTokens: 0,
      resets: null,
      daysLeft: null,
      noPlan: true,
    });
    expect(c.headline).toBe("No active plan");
    expect(c.detail).toContain("Pick a plan");
    expect(c.cta?.label).toBe("Upgrade");
  });
});
