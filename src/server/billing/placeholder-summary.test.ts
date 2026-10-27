import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTUMN_SEO_DATA_BALANCE_FEATURE_ID } from "@/shared/billing";

const { envMock } = vi.hoisted(() => {
  const kvStore = new Map<string, string>();
  return {
    envMock: {
      AUTH_MODE: "hosted",
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
  beforeEach(() => {
    // The shell may carry live values; process.env wins over the worker env.
    delete process.env.AUTH_MODE;
    delete process.env.AUTUMN_SECRET_KEY;
    envMock.AUTH_MODE = "hosted";
  });

  it("reports the daily allowance and what is left of it today", async () => {
    await placeholderAutumn.track({
      customerId: "org_1",
      featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
      value: 1250,
    });

    await expect(getPlaceholderBillingSummary("org_1")).resolves.toMatchObject({
      dailyAllowanceUsd: 3,
      remainingTodayUsd: 1.75,
    });
  });

  it("reports no allowance in self-hosted mode, which enforces none", async () => {
    // Regression: /subscribe showed self-hosters a daily allowance that
    // nothing in self-hosted mode meters.
    envMock.AUTH_MODE = "local_noauth";

    await expect(getPlaceholderBillingSummary("org_1")).resolves.toBeNull();
  });
});
