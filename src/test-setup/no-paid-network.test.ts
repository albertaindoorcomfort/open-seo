import { describe, expect, it } from "vitest";
import { PAID_HOSTS, PaidNetworkBlocked } from "./no-paid-network";

describe("paid-provider network guard", () => {
  it("is installed for the suite and blocks every paid host", async () => {
    for (const host of PAID_HOSTS) {
      await expect(fetch(`https://${host}/v3/anything`)).rejects.toBeInstanceOf(
        PaidNetworkBlocked,
      );
    }
  });
});
