import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTUMN_MANAGED_ACCESS_FEATURE_ID,
  AUTUMN_PAID_PLAN_FEATURE_ID,
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
} from "@/shared/billing";

const { store, envMock, optionalEnvMock } = vi.hoisted(() => {
  const kvStore = new Map<string, string>();
  return {
    store: kvStore,
    envMock: {
      LUNAR_OPTIMIZE_DAILY_USD: undefined as string | undefined,
      KV: {
        get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          kvStore.set(key, value);
        }),
      },
    },
    optionalEnvMock: vi.fn(),
  };
});

vi.mock("cloudflare:workers", () => ({ env: envMock }));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: optionalEnvMock,
}));

import {
  placeholderAutumn,
  placeholderDailyCredits,
  usesPlaceholderBilling,
} from "@/server/billing/autumn-placeholder";
import {
  isEmailAllowed,
  parseAllowedEmails,
} from "@/server/auth/signup-allowlist";

beforeEach(() => {
  store.clear();
  envMock.LUNAR_OPTIMIZE_DAILY_USD = undefined;
  optionalEnvMock.mockReset();
});

describe("usesPlaceholderBilling", () => {
  it("is on when AUTUMN_SECRET_KEY is unset or blank, off when set", async () => {
    optionalEnvMock.mockResolvedValue(undefined);
    expect(await usesPlaceholderBilling()).toBe(true);
    optionalEnvMock.mockResolvedValue("  ");
    expect(await usesPlaceholderBilling()).toBe(true);
    optionalEnvMock.mockResolvedValue("am_sk_test");
    expect(await usesPlaceholderBilling()).toBe(false);
  });
});

describe("placeholder ledger", () => {
  it("derives the daily allowance from LUNAR_OPTIMIZE_DAILY_USD (default 2 USD)", () => {
    expect(placeholderDailyCredits(undefined)).toBe(2000);
    expect(placeholderDailyCredits("0.5")).toBe(500);
    expect(placeholderDailyCredits("0")).toBe(0);
    expect(placeholderDailyCredits("nope")).toBe(2000);
  });

  it("grants the paid plan, never managed access or top-ups", async () => {
    const customerId = "org_1";
    expect(
      (
        await placeholderAutumn.check({
          customerId,
          featureId: AUTUMN_PAID_PLAN_FEATURE_ID,
        })
      ).allowed,
    ).toBe(true);
    expect(
      (
        await placeholderAutumn.check({
          customerId,
          featureId: AUTUMN_MANAGED_ACCESS_FEATURE_ID,
        })
      ).allowed,
    ).toBe(false);
    const topup = await placeholderAutumn.check({
      customerId,
      featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
    });
    expect(topup.balance?.remaining).toBe(0);
  });

  it("counts tracked spend against the day and blocks at the ceiling", async () => {
    envMock.LUNAR_OPTIMIZE_DAILY_USD = "1";
    const customerId = "org_2";
    const featureId = AUTUMN_SEO_DATA_BALANCE_FEATURE_ID;
    expect(
      (await placeholderAutumn.check({ customerId, featureId })).balance
        ?.remaining,
    ).toBe(1000);

    await placeholderAutumn.track({ customerId, featureId, value: 400 });
    const customer = await placeholderAutumn.customers.getOrCreate({
      customerId,
    });
    expect(customer.balances[featureId].remaining).toBe(600);

    await placeholderAutumn.track({ customerId, featureId, value: 600 });
    const spent = await placeholderAutumn.check({ customerId, featureId });
    expect(spent.allowed).toBe(false);
    expect(spent.balance?.remaining).toBe(0);

    // Other organizations have their own allowance.
    expect(
      (await placeholderAutumn.check({ customerId: "org_3", featureId }))
        .allowed,
    ).toBe(true);
  });
});

describe("signup allowlist", () => {
  it("defaults to the owner's address, case-insensitive", () => {
    expect(
      isEmailAllowed("digitaltools.mgt@ALBERTAINDOORCOMFORT.com", undefined),
    ).toBe(true);
    expect(isEmailAllowed("someone@example.com", undefined)).toBe(false);
  });

  it("reads a comma or space separated list", () => {
    expect([...parseAllowedEmails("a@x.io, B@y.io  c@z.io")]).toEqual([
      "a@x.io",
      "b@y.io",
      "c@z.io",
    ]);
    expect(isEmailAllowed("b@y.io", "a@x.io,b@y.io")).toBe(true);
    expect(
      isEmailAllowed("DigitalTools.Mgt@albertaindoorcomfort.com", "a@x.io"),
    ).toBe(false);
  });
});
