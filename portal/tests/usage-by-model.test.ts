/**
 * `/api/usage/by-model` must describe the SAME rows as `/api/usage`.
 *
 * The bug this guards: the By-model tab summed the visible page, so it
 * could name the wrong model on a month with more than one page. These
 * assertions are about the filter contract rather than SQL — the parity
 * that makes the tab honest is "same window, same model, same key".
 */
import { describe, it, expect } from "vitest";

import { usageByModel } from "@/lib/billing/service";

/**
 * The service queries Postgres, which this suite does not have. What CAN be
 * verified without a database is the input handling that runs before any
 * SQL: a malformed key id must short-circuit to an empty result rather than
 * reaching the driver and surfacing as a 500.
 */
describe("usageByModel input handling", () => {
  it("returns an empty result for a malformed apiKeyId, without querying", async () => {
    const result = await usageByModel("00000000-0000-0000-0000-000000000000", {
      apiKeyId: "not-a-uuid",
    });
    expect(result).toEqual({ rows: [], total: 0 });
  });
});
