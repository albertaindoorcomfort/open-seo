import { describe, expect, it, vi } from "vitest";
import { AUTUMN_SEO_DATA_BALANCE_FEATURE_ID } from "@/shared/billing";

const { envMock } = vi.hoisted(() => {
  const kvStore = new Map<string, string>();
  return {
    envMock: {
      LUNAR_OPTIMIZE_DAILY_USD: "3",
      KV: {
        get: async (key: string) => kvStore.get(key) ?? null,
        put: async (key: string, value: string) => {
          kvStore.set(key, value);
        },
      },
    },
  };
});

vi.mock("cloudflare:workers", () => ({ env: envMock }));

import { placeholderAutumn } from "@/server/billing/autumn-placeholder";
import { getPlaceholderBillingSummary } from "@/server/billing/placeholder-summary";

describe("getPlaceholderBillingSummary", () => {
  it("reports the daily allowance and what is left of it today", async () => {
    await placeholderAutumn.track({
      customerId: "org_1",
      featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
      value: 1250,
    });

    const summary = await getPlaceholderBillingSummary("org_1");

    expect(summary.dailyAllowanceUsd).toBe(3);
    expect(summary.remainingTodayUsd).toBe(1.75);
  });
});
