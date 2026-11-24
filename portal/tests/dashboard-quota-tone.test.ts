/**
 * The dashboard's one definition of "fine", "almost out" and "out".
 *
 * These boundaries are the only behaviour in Phase 1 that can be wrong
 * silently: the strip says "96% used" while the bar paints amber, and both
 * look plausible. Asserting 79/80/94/95/100 here is cheaper than noticing
 * it in a screenshot.
 */
import { describe, it, expect } from "vitest";

import {
  quotaTone,
  quotaPercent,
  needsAttention,
  daysRemainingAtRate,
} from "@/lib/dashboard/quota-tone";

const LIMIT = 50_000_000;

describe("quotaTone", () => {
  it("is unlimited when the plan has no budget", () => {
    expect(quotaTone(0, null)).toBe("unlimited");
    expect(quotaTone(0, 0)).toBe("unlimited");
    expect(quotaTone(123, -1)).toBe("unlimited");
    expect(quotaTone(123, Number.NaN)).toBe("unlimited");
  });

  it("is healthy below 80%", () => {
    expect(quotaTone(0, LIMIT)).toBe("healthy");
    expect(quotaTone(LIMIT * 0.79, LIMIT)).toBe("healthy");
  });

  it("watching starts exactly at 80%", () => {
    expect(quotaTone(LIMIT * 0.8 - 1, LIMIT)).toBe("healthy");
    expect(quotaTone(LIMIT * 0.8, LIMIT)).toBe("watching");
    expect(quotaTone(LIMIT * 0.94, LIMIT)).toBe("watching");
  });

  it("warning starts exactly at 95%", () => {
    expect(quotaTone(LIMIT * 0.949, LIMIT)).toBe("watching");
    expect(quotaTone(LIMIT * 0.95, LIMIT)).toBe("warning");
    expect(quotaTone(LIMIT - 1, LIMIT)).toBe("warning");
  });

  it("blocked at the limit and beyond", () => {
    expect(quotaTone(LIMIT, LIMIT)).toBe("blocked");
    expect(quotaTone(LIMIT + 1, LIMIT)).toBe("blocked");
  });

  it("treats negative or non-finite usage as zero", () => {
    expect(quotaTone(-5, LIMIT)).toBe("healthy");
    expect(quotaTone(Number.NaN, LIMIT)).toBe("healthy");
  });
});

describe("quotaPercent", () => {
  it("clamps to 0..100 and rounds", () => {
    expect(quotaPercent(0, LIMIT)).toBe(0);
    expect(quotaPercent(LIMIT / 2, LIMIT)).toBe(50);
    expect(quotaPercent(LIMIT * 2, LIMIT)).toBe(100);
    expect(quotaPercent(5, null)).toBe(0);
  });
});

describe("needsAttention", () => {
  it("is true only for warning and blocked", () => {
    expect(needsAttention("warning")).toBe(true);
    expect(needsAttention("blocked")).toBe(true);
    expect(needsAttention("watching")).toBe(false);
    expect(needsAttention("healthy")).toBe(false);
    expect(needsAttention("unlimited")).toBe(false);
  });
});

describe("daysRemainingAtRate", () => {
  const start = "2026-11-01T00:00:00.000Z";
  const now = new Date("2026-11-11T00:00:00.000Z"); // 10 days elapsed

  it("divides the remainder by the average daily spend", () => {
    // 10M spent over 10 days = 1M/day; 40M left = 40 days.
    expect(daysRemainingAtRate(LIMIT, 10_000_000, start, now)).toBe(40);
  });

  it("returns 0 when the pool is already spent", () => {
    expect(daysRemainingAtRate(LIMIT, LIMIT, start, now)).toBe(0);
    expect(daysRemainingAtRate(LIMIT, LIMIT + 1, start, now)).toBe(0);
  });

  it("returns null when there is no rate to average", () => {
    expect(daysRemainingAtRate(LIMIT, 0, start, now)).toBeNull();
    expect(daysRemainingAtRate(null, 5, start, now)).toBeNull();
    expect(daysRemainingAtRate(0, 5, start, now)).toBeNull();
  });

  it("returns null for a missing or future period start", () => {
    expect(daysRemainingAtRate(LIMIT, 5, null, now)).toBeNull();
    expect(daysRemainingAtRate(LIMIT, 5, "not-a-date", now)).toBeNull();
    expect(
      daysRemainingAtRate(LIMIT, 5, "2026-12-01T00:00:00.000Z", now),
    ).toBeNull();
  });

  it("floors, so it never promises a day the customer will not get", () => {
    // 30M spent over 10 days = 3M/day; 20M left = 6.67 -> 6.
    expect(daysRemainingAtRate(LIMIT, 30_000_000, start, now)).toBe(6);
  });
});
