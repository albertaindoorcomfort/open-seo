import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ key: undefined as string | undefined }));

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async (name: string) => {
    if (name === "DATAFORSEO_API_KEY" && env.key) return env.key;
    throw new Error(`Missing required environment variable: ${name}`);
  }),
}));

import { labsApi, serpApi } from "@/server/lib/dataforseo/core";
import {
  dataforseoSampleReason,
  inDataforseoSampleMode,
  markDataforseoLive,
  sampleDataforseoBody,
  sampleRankPosition,
  sampleReasonFor,
} from "@/server/lib/dataforseo/sample";
import { DataforseoLabsGoogleKeywordSuggestionsLiveRequestInfo, SerpGoogleOrganicLiveAdvancedRequestInfo } from "dataforseo-client";

beforeEach(() => {
  env.key = undefined;
  markDataforseoLive();
});
afterEach(() => vi.unstubAllGlobals());

function itemsOf(body: Record<string, unknown>) {
  return (body.tasks as Array<{ result: Array<{ items: Array<{ domain: string }> }> }>)[0].result[0].items;
}

describe("sample bodies", () => {
  it("keep the DataForSEO envelope so parsers and billing run unchanged, at no cost", () => {
    const body = sampleDataforseoBody("https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live", [{ keyword: "Heat Pump", location_code: 2124, language_code: "en" }]);
    expect(body).toMatchObject({ status_code: 20000, cost: 0, lunar_sample: true });
    const task = (body.tasks as Array<Record<string, unknown>>)[0];
    expect(task).toMatchObject({ status_code: 20000, cost: 0, path: ["dataforseo_labs", "google", "keyword_suggestions", "live"] });
    const items = (task.result as Array<{ items: Array<{ keyword: string; keyword_info: { search_volume: number } }> }>)[0].items;
    expect(items[0].keyword).toBe("heat pump");
    expect(items.length).toBeGreaterThan(5);
    expect(items.every((i) => i.keyword_info.search_volume > 0)).toBe(true);
  });

  it("is deterministic and uses reserved .example domains for results pages", () => {
    const url = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
    const a = sampleDataforseoBody(url, [{ keyword: "heat pump" }]);
    const b = sampleDataforseoBody(url, [{ keyword: "heat pump" }]);
    expect(itemsOf(a)).toEqual(itemsOf(b));
    const items = itemsOf(a);
    expect(items).toHaveLength(10);
    expect(items.every((i) => i.domain.endsWith(".example"))).toBe(true);
  });

  it("answers unknown endpoints with a valid empty result", () => {
    const body = sampleDataforseoBody("https://api.dataforseo.com/v3/business_data/google/reviews/task_get/x", [{}]);
    expect((body.tasks as Array<{ result: unknown[] }>)[0].result).toEqual([{ total_count: 0, items_count: 0, items: [] }]);
  });

  it("maps refusals to sample reasons and leaves real errors alone", () => {
    expect(sampleReasonFor(401)).toBe("auth");
    expect(sampleReasonFor(402)).toBe("credits");
    expect(sampleReasonFor(200, 40210)).toBe("credits");
    expect(sampleReasonFor(200, 40202)).toBe("quota");
    expect(sampleReasonFor(500)).toBeNull();
    expect(sampleReasonFor(200, 20000)).toBeNull();
  });

  it("gives stable sample rank positions", () => {
    expect(sampleRankPosition("heat pump", "desktop")).toBe(sampleRankPosition("Heat Pump ", "desktop"));
  });
});

describe("authenticated fetch in sample mode", () => {
  it("answers with sample data and makes no network call when DATAFORSEO_API_KEY is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await labsApi().googleKeywordSuggestionsLive([
      new DataforseoLabsGoogleKeywordSuggestionsLiveRequestInfo({ keyword: "heat pump", location_code: 2124, language_code: "en", limit: 10 }),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res?.tasks?.[0]?.result?.[0]?.items?.length).toBeGreaterThan(5);
    expect(dataforseoSampleReason()).toBe("no_key");
    expect(await inDataforseoSampleMode()).toBe(true);
  });

  it("falls back to sample data when DataForSEO is out of credits, and goes live again after a good answer", async () => {
    env.key = "a2V5OnNlY3JldA==";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 40200, status_message: "Payment Required.", result: null }] }), { status: 200, headers: { "content-type": "application/json" } })));
    const res = await serpApi().googleOrganicLiveAdvanced([new SerpGoogleOrganicLiveAdvancedRequestInfo({ keyword: "heat pump", location_code: 2124, language_code: "en" })]);
    expect(res?.tasks?.[0]?.status_code).toBe(20000);
    expect(dataforseoSampleReason()).toBe("credits");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: 20000, cost: 0.002, tasks: [{ status_code: 20000, path: ["serp"], cost: 0.002, result: [{ items: [] }] }] }), { status: 200, headers: { "content-type": "application/json" } })));
    await serpApi().googleOrganicLiveAdvanced([new SerpGoogleOrganicLiveAdvancedRequestInfo({ keyword: "heat pump", location_code: 2124, language_code: "en" })]);
    expect(dataforseoSampleReason()).toBeNull();
    expect(await inDataforseoSampleMode()).toBe(false);
  });
});
