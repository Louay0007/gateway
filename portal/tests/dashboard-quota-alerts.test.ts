/**
 * When a customer is emailed about their pool.
 *
 * Two failure modes this guards, both expensive:
 *   - too eager: the 15-minute job mails 80% at 80, 81, 82… until it is muted
 *   - too quiet: the first signal is a 403
 *
 * The ledger (`alreadySent`) is the mechanism, so most of these cases are
 * about it rather than about arithmetic.
 */
import { describe, it, expect } from "vitest";

import {
  nextQuotaAlert,
  normalizeThresholds,
  DEFAULT_THRESHOLDS,
} from "@/lib/dashboard/quota-alerts";

const POOL = 50_000_000;
const base = {
  poolTokens: POOL,
  thresholds: [80, 95],
  onExhausted: true,
  alreadySent: [] as number[],
};

describe("nextQuotaAlert", () => {
  it("says nothing below the lowest threshold", () => {
    expect(nextQuotaAlert({ ...base, poolUsedTokens: POOL * 0.79 })).toBeNull();
  });

  it("fires the 80 threshold exactly at 80%", () => {
    expect(nextQuotaAlert({ ...base, poolUsedTokens: POOL * 0.8 })).toEqual({
      kind: "threshold",
      threshold: 80,
    });
  });

  it("does not re-send a threshold already in the ledger", () => {
    expect(
      nextQuotaAlert({ ...base, poolUsedTokens: POOL * 0.81, alreadySent: [80] }),
    ).toBeNull();
  });

  it("moves on to 95 once 80 has been sent", () => {
    expect(
      nextQuotaAlert({ ...base, poolUsedTokens: POOL * 0.95, alreadySent: [80] }),
    ).toEqual({ kind: "threshold", threshold: 95 });
  });

  it("sends only the highest crossed threshold in one pass", () => {
    // A jump from 79% to 97% must not queue two mails.
    expect(nextQuotaAlert({ ...base, poolUsedTokens: POOL * 0.97 })).toEqual({
      kind: "threshold",
      threshold: 95,
    });
  });

  it("sends the exhausted mail, once", () => {
    expect(nextQuotaAlert({ ...base, poolUsedTokens: POOL })).toEqual({
      kind: "exhausted",
      threshold: 100,
    });
    expect(
      nextQuotaAlert({ ...base, poolUsedTokens: POOL, alreadySent: [80, 95, 100] }),
    ).toBeNull();
  });

  it("honours the exhausted opt-out", () => {
    expect(
      nextQuotaAlert({
        ...base,
        poolUsedTokens: POOL,
        onExhausted: false,
        alreadySent: [80, 95],
      }),
    ).toBeNull();
  });

  it("never alerts an unlimited plan", () => {
    expect(nextQuotaAlert({ ...base, poolTokens: null, poolUsedTokens: 999 })).toBeNull();
    expect(nextQuotaAlert({ ...base, poolTokens: 0, poolUsedTokens: 999 })).toBeNull();
  });

  it("ignores a custom threshold above 99 for the threshold path", () => {
    // 100 is the exhausted mail's job; a subscriber listing 100 as a
    // threshold must not get a duplicate at the same point.
    expect(
      nextQuotaAlert({ ...base, thresholds: [100], poolUsedTokens: POOL * 0.995 }),
    ).toBeNull();
  });

  it("treats a garbage threshold list as no thresholds", () => {
    expect(
      nextQuotaAlert({ ...base, thresholds: [0, -5, 101, Number.NaN] as number[], poolUsedTokens: POOL * 0.99 }),
    ).toBeNull();
  });
});

describe("normalizeThresholds", () => {
  it("falls back to the documented defaults", () => {
    expect(normalizeThresholds(undefined)).toEqual([...DEFAULT_THRESHOLDS]);
    expect(normalizeThresholds("nonsense")).toEqual([...DEFAULT_THRESHOLDS]);
    expect(normalizeThresholds([])).toEqual([...DEFAULT_THRESHOLDS]);
    expect(normalizeThresholds([0, 140])).toEqual([...DEFAULT_THRESHOLDS]);
  });

  it("dedupes and sorts a real list", () => {
    expect(normalizeThresholds([95, 80, 80])).toEqual([80, 95]);
  });
});
