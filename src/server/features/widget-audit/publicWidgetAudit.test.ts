import { describe, expect, it, vi } from "vitest";
import {
  createPublicWidgetAuditHandler,
  PublicWidgetAuditError,
  type SearchOverviewObservation,
} from "@/server/features/widget-audit/publicWidgetAudit";

const fixedNow = new Date("2026-08-20T12:00:00.000Z");

function searchObservation(
  overrides: Partial<SearchOverviewObservation> = {},
): SearchOverviewObservation {
  return {
    status: "AVAILABLE",
    organicTraffic: 321,
    organicKeywords: 45,
    fetchedAt: fixedNow.toISOString(),
    dataAsOf: null,
    provider: "dataforseo",
    integration: "domain_rank_overview_live",
    sourceClass: "estimated",
    locationCode: 2124,
    locationLabel: "Canada",
    languageCode: "en",
    completeness: "complete",
    ...overrides,
  };
}

function createHandler(
  getSearchOverview = vi.fn(async () => searchObservation()),
) {
  const onError = vi.fn();
  return {
    getSearchOverview,
    onError,
    handler: createPublicWidgetAuditHandler({
      normalizeDomain: () => "example.com",
      getSearchOverview,
      now: () => fixedNow,
      onError,
    }),
  };
}

describe("public widget audit handler", () => {
  it("returns only acquired search evidence and marks unavailable layers explicitly", async () => {
    const { handler, getSearchOverview } = createHandler();
    const response = await handler(
      new Request("https://app.openseo.so/api/widget/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "https://www.example.com/path",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      schemaVersion: "2026-08-20",
      auditMode: "public_baseline",
      status: "PARTIAL",
      domain: "example.com",
      summary: {
        reputationRiskScore: { status: "NOT_COMPUTED", value: null },
        overallDataConfidence: { status: "NOT_COMPUTED", value: null },
      },
      layers: {
        search: {
          status: "AVAILABLE",
          organicTraffic: 321,
          organicKeywords: 45,
          provider: "dataforseo",
          sourceClass: "estimated",
          reconciliationStatus: "UNRESOLVED",
          confidence: null,
        },
        reputation: { status: "UNAVAILABLE" },
        analytics: { status: "NOT_CONNECTED" },
        brand: { status: "NOT_RUN" },
        execution: { status: "NOT_CONNECTED" },
      },
      discrepancies: [],
      findings: [],
      report: { available: false },
    });
    expect(getSearchOverview).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "example.com" }),
    );
  });

  it("rejects malformed and unknown-field input before provider execution", async () => {
    const { handler, getSearchOverview } = createHandler();
    const malformed = await handler(
      new Request("https://app.openseo.so/api/widget/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(malformed.status).toBe(400);

    const unknownField = await handler(
      new Request("https://app.openseo.so/api/widget/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "example.com",
          organizationId: "should-not-be-accepted",
        }),
      }),
    );
    expect(unknownField.status).toBe(400);
    expect(getSearchOverview).not.toHaveBeenCalled();
  });

  it("accepts optional lead email without treating it as a billing identity", async () => {
    const { handler, getSearchOverview } = createHandler();
    const response = await handler(
      new Request("https://app.openseo.so/api/widget/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "example.com",
          email: "owner@example.com",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(getSearchOverview).toHaveBeenCalledOnce();
  });

  it("preserves public rate-limit errors without exposing internal failures", async () => {
    const limited = createHandler(
      vi.fn(async () => {
        throw new PublicWidgetAuditError(
          429,
          "RATE_LIMITED",
          "Too many audit requests. Try again in a minute.",
          60,
        );
      }),
    );
    const limitedResponse = await limited.handler(
      new Request("https://app.openseo.so/api/widget/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "example.com" }),
      }),
    );
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("retry-after")).toBe("60");

    const failed = createHandler(
      vi.fn(async () => {
        throw new Error("secret provider response");
      }),
    );
    const failedResponse = await failed.handler(
      new Request("https://app.openseo.so/api/widget/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "example.com" }),
      }),
    );
    expect(failedResponse.status).toBe(502);
    expect(await failedResponse.text()).not.toContain(
      "secret provider response",
    );
    expect(failed.onError).toHaveBeenCalledOnce();
  });

  it("handles cross-origin preflight without invoking providers", async () => {
    const { handler, getSearchOverview } = createHandler();
    const response = await handler(
      new Request("https://app.openseo.so/api/widget/audit", {
        method: "OPTIONS",
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(getSearchOverview).not.toHaveBeenCalled();
  });
});
