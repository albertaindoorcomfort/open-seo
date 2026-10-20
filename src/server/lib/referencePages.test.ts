import { afterEach, describe, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({ blocked: new Set<string>() }));

vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: vi.fn(async (url: string) => {
    const host = new URL(url).hostname;
    if (policy.blocked.has(host)) throw new Error("blocked");
    return url;
  }),
}));

import { buildContentReferenceFromPages } from "@/server/lib/referencePages";

const words = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");
const page = (topic: string) =>
  `<html><head><title>${topic}</title></head><body><main><h1>${topic}</h1><h2>Costs</h2><p>${words(30, "Federal rebates and provincial grants lower the upfront price.")}</p><h2>Timing</h2><p>${words(10, "A licensed installer finishes most jobs in two days.")}</p></main></body></html>`;
const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
  policy.blocked.clear();
});

describe("content score reference pages", () => {
  it("measures public pages and returns counts only, never page text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html(page("Heat pump cost"))));
    const { reference, attempts } = await buildContentReferenceFromPages({ keyword: "Heat pump cost", urls: ["https://a.example/x", "https://b.example/y"] });
    expect(attempts).toEqual([{ url: "https://a.example/x", ok: true }, { url: "https://b.example/y", ok: true }]);
    expect(reference.pages).toHaveLength(2);
    expect(reference.terms.map((t) => t.term)).toContain("federal rebates");
    expect(JSON.stringify(reference)).not.toMatch(/licensed installer finishes most jobs in two days\./);
  });

  it("refuses blocked addresses, including a redirect to one", async () => {
    policy.blocked.add("169.254.169.254");
    const fetchSpy = vi.fn(async () => html("", 302, { location: "http://169.254.169.254/latest/meta-data" }));
    vi.stubGlobal("fetch", fetchSpy);
    const { attempts } = await buildContentReferenceFromPages({ keyword: "heat pump", urls: ["https://169.254.169.254/", "https://redirector.example/"] });
    expect(attempts[0]).toMatchObject({ ok: false, error: "That address cannot be fetched." });
    expect(attempts[1]).toMatchObject({ ok: false, error: "The page redirected to an address that cannot be fetched." });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the redirector, never the metadata address
  });

  it("skips non-HTML, oversized and thin pages with a reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("pdf")) return new Response("%PDF", { headers: { "content-type": "application/pdf" } });
      if (url.includes("big")) return html("x".repeat(2_100_000));
      return html("<main><p>Too short.</p></main>");
    }));
    const { attempts, reference } = await buildContentReferenceFromPages({ keyword: "heat pump", urls: ["https://a.example/pdf", "https://a.example/big", "https://a.example/thin"] });
    expect(attempts.map((a) => a.error)).toEqual(["Only web pages can be measured.", "The page is larger than 2 MB.", "The page has too little readable text."]);
    expect(reference.pages).toEqual([]);
  });
});
