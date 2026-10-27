import { describe, expect, it } from "vitest";
import type { DashboardActivation } from "@/server/features/dashboard/services/DashboardService";
import { computeNextStep, getDashboardSteps } from "./dashboardSteps";

// Domain set and MCP connected, so Search Console is the next step if offered.
function activation(googleOAuthConfigured: boolean): DashboardActivation {
  return {
    domain: "acme.com",
    ga4: { connected: false, propertyDisplayName: null, cardDismissedAt: null },
    gsc: { connected: false, siteUrl: null, googleOAuthConfigured },
    mcp: {
      authorizedAt: "2026-10-27",
      firstToolCallAt: null,
      cardDismissedAt: null,
    },
    competitorClickedAt: null,
  };
}

describe("dashboard checklist steps", () => {
  it("skips the Search Console step when Google is not configured", () => {
    // Regression: the checklist asked to connect Search Console forever on a
    // deployment with no Google client ids, where nobody can connect it.
    expect(getDashboardSteps(activation(false))).not.toContain("gsc");
    expect(computeNextStep(activation(false))).toBe("competitor");
    expect(computeNextStep(activation(true))).toBe("gsc");
  });
});
