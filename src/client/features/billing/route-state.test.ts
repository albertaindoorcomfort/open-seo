import { describe, expect, it } from "vitest";
import { getBillingRouteState, getSubscribeRouteState } from "./route-state";

describe("getBillingRouteState", () => {
  const base = {
    hasSession: true,
    isSessionPending: false,
    billingMode: "autumn" as const,
    isCustomerLoading: false,
    isCustomerError: false,
  };

  it("shows ready after successful customer lookup", () => {
    expect(getBillingRouteState(base)).toBe("ready");
  });

  it("shows an error state on billing lookup failures", () => {
    expect(getBillingRouteState({ ...base, isCustomerError: true })).toBe(
      "error",
    );
  });

  it("shows the placeholder ledger instead of its failed customer lookup", () => {
    expect(
      getBillingRouteState({
        ...base,
        billingMode: "placeholder",
        isCustomerError: true,
      }),
    ).toBe("placeholder");
  });

  it("keeps the page blank while auth or billing data is still loading", () => {
    expect(getBillingRouteState({ ...base, isSessionPending: true })).toBe(
      "loading",
    );
    expect(getBillingRouteState({ ...base, billingMode: undefined })).toBe(
      "loading",
    );
    expect(getBillingRouteState({ ...base, isCustomerLoading: true })).toBe(
      "loading",
    );
  });
});

describe("getSubscribeRouteState", () => {
  // hasManagedAccess is true for essentially every hosted customer: the free
  // plan is the Autumn default and grants managed_service_access too.
  const base = {
    hasSession: true,
    billingMode: "autumn" as const,
    checkoutEnabled: true,
    isCustomerLoading: false,
    isCustomerError: false,
    hasManagedAccess: true,
    planStatus: "free" as const,
    isUpgradeFlow: false,
    checkoutCompleted: false,
    finalizingTimedOut: false,
  };

  it("shows an error state on billing lookup failures", () => {
    expect(getSubscribeRouteState({ ...base, isCustomerError: true })).toBe(
      "error",
    );
  });

  it("shows the placeholder ledger before any error", () => {
    expect(
      getSubscribeRouteState({
        ...base,
        billingMode: "placeholder",
        isCustomerError: true,
      }),
    ).toBe("placeholder");
  });

  it("says checkout is off before any error, and still lets paying customers in", () => {
    // Regression: the error branch ran first, so a checkout that is off on
    // purpose read as "Billing unavailable" with a dead Try again.
    const checkoutOff = { ...base, checkoutEnabled: false };
    // A failed lookup has no customer to read managed access from.
    expect(
      getSubscribeRouteState({
        ...checkoutOff,
        isCustomerError: true,
        hasManagedAccess: false,
      }),
    ).toBe("checkoutDisabled");
    expect(
      getSubscribeRouteState({ ...checkoutOff, isUpgradeFlow: true }),
    ).toBe("checkoutDisabled");
    expect(getSubscribeRouteState({ ...checkoutOff, planStatus: "paid" })).toBe(
      "redirectToApp",
    );
  });

  it("waits for the customer while checkout is off", () => {
    // Regression: "subscriptions are being configured" flashed before the
    // customer loaded, even for users about to be sent into the app.
    expect(
      getSubscribeRouteState({
        ...base,
        checkoutEnabled: false,
        isCustomerLoading: true,
      }),
    ).toBe("loading");
  });

  it("sends free-plan users who did not ask to upgrade into the app while checkout is off", () => {
    // Regression: they were stopped on the checkout-off page instead.
    expect(getSubscribeRouteState({ ...base, checkoutEnabled: false })).toBe(
      "redirectToApp",
    );
  });

  it("keeps the page blank while billing data is still loading", () => {
    expect(getSubscribeRouteState({ ...base, isCustomerLoading: true })).toBe(
      "loading",
    );
    expect(getSubscribeRouteState({ ...base, billingMode: undefined })).toBe(
      "loading",
    );
  });

  it("redirects paying customers into the app", () => {
    expect(getSubscribeRouteState({ ...base, planStatus: "paid" })).toBe(
      "redirectToApp",
    );
  });

  it("redirects free-plan users into the app outside the upgrade flow", () => {
    expect(getSubscribeRouteState(base)).toBe("redirectToApp");
  });

  it("shows the paywall to free-plan users in the upgrade flow", () => {
    expect(getSubscribeRouteState({ ...base, isUpgradeFlow: true })).toBe(
      "showPaywall",
    );
  });

  it("finalizes after checkout even though managed access would redirect", () => {
    // Regression: managed access is granted by the free plan, so checking it
    // before checkoutCompleted sent just-paid users into the app as "free".
    expect(getSubscribeRouteState({ ...base, checkoutCompleted: true })).toBe(
      "finalizing",
    );
  });

  it("lets the user through once the finalizing window runs out", () => {
    expect(
      getSubscribeRouteState({
        ...base,
        checkoutCompleted: true,
        finalizingTimedOut: true,
      }),
    ).toBe("redirectToApp");

    // Even a poll error must not extend the wait past the deadline.
    expect(
      getSubscribeRouteState({
        ...base,
        checkoutCompleted: true,
        finalizingTimedOut: true,
        isCustomerError: true,
      }),
    ).toBe("redirectToApp");
  });

  it("shows the paywall to users without managed access", () => {
    expect(getSubscribeRouteState({ ...base, hasManagedAccess: false })).toBe(
      "showPaywall",
    );
  });
});
