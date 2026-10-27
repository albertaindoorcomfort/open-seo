import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const env = vi.hoisted(() => ({ key: undefined as string | undefined }));

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async (name: string) => {
    if (name === "DATAFORSEO_API_KEY" && env.key) return env.key;
    throw new Error(`Missing required environment variable: ${name}`);
  }),
}));

import {
  fetchLlmMentionsSearch,
  fetchLlmResponse,
} from "@/server/lib/dataforseo/ai";
import { fetchDomainPagesSummary } from "@/server/lib/dataforseo/backlinks";
import { fetchBusinessListingsSearch } from "@/server/lib/dataforseo/business";
import { labsApi, serpApi } from "@/server/lib/dataforseo/core";
import {
  inDataforseoSampleMode,
  sampleDataforseoBody,
  sampleRankPosition,
  sampleReasonFor,
} from "@/server/lib/dataforseo/sample";
import { trackDataforseoSample } from "@/server/lib/dataforseo/sample-scope";
import { postRankCheckTasks } from "@/server/lib/dataforseo/serp";
import {
  DataforseoLabsGoogleKeywordSuggestionsLiveRequestInfo,
  SerpGoogleOrganicLiveAdvancedRequestInfo,
} from "dataforseo-client";

beforeEach(() => {
  env.key = undefined;
});
afterEach(() => vi.unstubAllGlobals());

/** A DataForSEO answer whose first task carries `taskStatus` (40200 = out of credits). */
function dataforseoAnswer(taskStatus: number, httpStatus = 200): Response {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      tasks: [
        {
          status_code: taskStatus,
          status_message: "x",
          path: ["serp"],
          cost: 0,
          result: taskStatus === 20000 ? [{ items: [] }] : null,
        },
      ],
    }),
    { status: httpStatus, headers: { "content-type": "application/json" } },
  );
}

function searchSerp(keyword: string) {
  return serpApi().googleOrganicLiveAdvanced([
    new SerpGoogleOrganicLiveAdvancedRequestInfo({
      keyword,
      location_code: 2124,
      language_code: "en",
    }),
  ]);
}

const envelopeSchema = z.object({
  tasks: z.array(z.object({ result: z.array(z.unknown()) })),
});

function resultOf(body: unknown): unknown[] {
  return envelopeSchema.parse(body).tasks[0].result;
}

function itemsOf<T extends z.ZodType>(body: unknown, item: T) {
  return z.object({ items: z.array(item) }).parse(resultOf(body)[0]).items;
}

const keywordItem = z.object({
  keyword: z.string(),
  keyword_info: z.object({ search_volume: z.number() }),
});
// Loose so the determinism check compares every field of each result.
const domainItem = z.looseObject({ domain: z.string() });

describe("sample bodies", () => {
  it("keep the DataForSEO envelope so parsers and billing run unchanged, at no cost", () => {
    const body = sampleDataforseoBody(
      "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live",
      [{ keyword: "Heat Pump", location_code: 2124, language_code: "en" }],
    );
    expect(body).toMatchObject({
      status_code: 20000,
      cost: 0,
      lunar_sample: true,
      tasks: [
        {
          status_code: 20000,
          cost: 0,
          path: ["dataforseo_labs", "google", "keyword_suggestions", "live"],
        },
      ],
    });
    const items = itemsOf(body, keywordItem);
    expect(items[0].keyword).toBe("heat pump");
    expect(items.length).toBeGreaterThan(5);
    expect(items.every((i) => i.keyword_info.search_volume > 0)).toBe(true);
  });

  it("is deterministic and uses reserved .example domains for results pages", () => {
    const url =
      "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
    const a = sampleDataforseoBody(url, [{ keyword: "heat pump" }]);
    const b = sampleDataforseoBody(url, [{ keyword: "heat pump" }]);
    expect(itemsOf(a, domainItem)).toEqual(itemsOf(b, domainItem));
    const items = itemsOf(a, domainItem);
    expect(items).toHaveLength(10);
    expect(items.every((i) => i.domain.endsWith(".example"))).toBe(true);
  });

  it("answers unknown endpoints with a valid empty result", () => {
    const body = sampleDataforseoBody(
      "https://api.dataforseo.com/v3/business_data/google/reviews/task_get/x",
      [{}],
    );
    expect(resultOf(body)).toEqual([
      { total_count: 0, items_count: 0, items: [] },
    ]);
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
    expect(sampleRankPosition("heat pump", "desktop")).toBe(
      sampleRankPosition("Heat Pump ", "desktop"),
    );
  });
});

describe("authenticated fetch in sample mode", () => {
  it("answers with sample data and makes no network call when DATAFORSEO_API_KEY is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { value: res, answer } = await trackDataforseoSample(() =>
      labsApi().googleKeywordSuggestionsLive([
        new DataforseoLabsGoogleKeywordSuggestionsLiveRequestInfo({
          keyword: "heat pump",
          location_code: 2124,
          language_code: "en",
          limit: 10,
        }),
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res?.tasks?.[0]?.result?.[0]?.items?.length).toBeGreaterThan(5);
    expect(answer).toBe("no_key");
  });

  it("keeps one request's refusal out of another request running at the same time", async () => {
    env.key = "a2V5OnNlY3JldA==";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) =>
        dataforseoAnswer(
          typeof init?.body === "string" && init.body.includes("refused")
            ? 40200
            : 20000,
        ),
      ),
    );
    const request = (keyword: string) =>
      trackDataforseoSample(async () => {
        await searchSerp(keyword);
        return inDataforseoSampleMode();
      });

    const [refused, live] = await Promise.all([
      request("refused keyword"),
      request("heat pump"),
    ]);

    expect(refused).toMatchObject({ value: true, answer: "credits" });
    expect(live).toMatchObject({ value: false, answer: "live" });
  });

  it("fails a refusal outside any request scope as a real error, not as unlabelled sample data", async () => {
    env.key = "a2V5OnNlY3JldA==";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => dataforseoAnswer(40200, 402)),
    );
    await expect(searchSerp("heat pump")).rejects.toThrow(
      "DataForSEO HTTP 402",
    );
  });

  it("accepts sample task_post tasks with 20100, so queued rank checks stay on the queued path", async () => {
    const posted = await postRankCheckTasks({
      tasks: [{ keyword: "heat pump", keywordId: "kw_1", device: "desktop" }],
      locationCode: 2124,
      languageCode: "en",
      depth: 20,
      targetDomain: "acme.com",
    });
    expect(posted.data).toHaveLength(1);
    expect(posted.data[0]).toMatchObject({
      keyword: "heat pump",
      keywordId: "kw_1",
      device: "desktop",
    });
    expect(posted.data[0]?.taskId).toMatch(/^sample-/);
  });

  it("answers the AI, backlink top pages and local listings endpoints with labelled samples", async () => {
    const answer = await fetchLlmResponse({
      userPrompt: "best heat pump installer",
      modelSlug: "chat_gpt",
      modelName: "gpt-5",
    });
    expect(answer.data.items?.[0]?.sections?.[0]?.text).toMatch(
      /^Sample answer, not a model response/,
    );

    const mentions = await fetchLlmMentionsSearch({
      target: { domain: "acme.com" },
      platform: "google",
      locationCode: 2124,
      languageCode: "en",
    });
    expect(mentions.data.length).toBeGreaterThan(0);
    expect(
      mentions.data.every((m) => m.question?.startsWith("Sample question")),
    ).toBe(true);

    const pages = await fetchDomainPagesSummary({ target: "acme.com" });
    expect(pages.data.items.length).toBeGreaterThan(0);
    expect(
      pages.data.items.every((p) => p.url?.startsWith("https://acme.com/")),
    ).toBe(true);

    const listings = await fetchBusinessListingsSearch({
      locationCoordinate: "51.04,-114.07,5000",
      limit: 10,
    });
    expect(listings.data.length).toBeGreaterThan(0);
    expect(
      listings.data.every(
        (l) =>
          l.title?.startsWith("Sample business") &&
          l.domain?.endsWith(".example"),
      ),
    ).toBe(true);
  });
});
