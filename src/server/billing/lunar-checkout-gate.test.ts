import { describe, expect, it } from "vitest";
import { isLunarCheckoutBlocked } from "./lunar-checkout-gate";

const request = (method: string, path: string) => ({
  method,
  url: `https://seo.projectlunar.ai${path}`,
});

describe("Lunar checkout gate", () => {
  it("blocks every plan or payment mutation until explicitly enabled", () => {
    for (const route of [
      "attach",
      "multiAttach",
      "updateSubscription",
      "setupPayment",
      "redeemReferralCode",
      "unknownFutureRoute",
    ]) {
      expect(
        isLunarCheckoutBlocked(
          request("POST", `/api/autumn/${route}`),
          undefined,
        ),
      ).toBe(true);
      expect(
        isLunarCheckoutBlocked(request("POST", `/api/autumn/${route}`), "true"),
      ).toBe(false);
    }
  });

  it("retains customer reads and billing management", () => {
    expect(
      isLunarCheckoutBlocked(request("GET", "/api/autumn/customer"), undefined),
    ).toBe(false);
    expect(
      isLunarCheckoutBlocked(
        request("POST", "/api/autumn/openCustomerPortal"),
        undefined,
      ),
    ).toBe(false);
    expect(
      isLunarCheckoutBlocked(
        request("POST", "/api/autumn/getOrCreateCustomer"),
        undefined,
      ),
    ).toBe(false);
  });
});
