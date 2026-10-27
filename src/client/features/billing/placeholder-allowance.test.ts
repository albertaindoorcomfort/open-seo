import { describe, expect, it } from "vitest";
import { PLACEHOLDER_ALLOWANCE_USED_MESSAGE } from "@/shared/billing";
import { getPlaceholderAllowanceNotice } from "./placeholder-allowance";

describe("getPlaceholderAllowanceNotice", () => {
  // Regression: on the placeholder ledger the project banner read Autumn,
  // which answers 503 there, so nobody near or at the allowance was warned.
  it("warns near the daily allowance and says when it is used up", () => {
    expect(
      getPlaceholderAllowanceNotice({
        dailyAllowanceUsd: 2,
        remainingTodayUsd: 0.1,
      }),
    ).toEqual({
      variant: "warning",
      message:
        "You have $0.10 left of today's $2.00 free allowance. It resets at midnight UTC.",
    });
    expect(
      getPlaceholderAllowanceNotice({
        dailyAllowanceUsd: 2,
        remainingTodayUsd: 0,
      }),
    ).toEqual({
      variant: "error",
      message: PLACEHOLDER_ALLOWANCE_USED_MESSAGE,
    });
  });

  it("stays quiet while there is room left today", () => {
    expect(
      getPlaceholderAllowanceNotice({
        dailyAllowanceUsd: 2,
        remainingTodayUsd: 1.5,
      }),
    ).toBeNull();
  });
});
