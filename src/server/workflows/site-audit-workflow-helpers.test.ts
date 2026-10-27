import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crawlPage } from "@/server/workflows/site-audit-workflow-helpers";

/** DNS over HTTPS answers 127.0.0.1 for every name; pages answer 200. */
function stubNetwork(pageRequests: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.startsWith("https://cloudflare-dns.com/")) {
        return Response.json({
          Status: 0,
          Answer: [{ type: 1, data: "127.0.0.1" }],
        });
      }
      pageRequests.push(input);
      return new Response("<html><title>internal</title></html>", {
        headers: { "content-type": "text/html" },
      });
    }),
  );
}

describe("crawlPage SSRF guard", () => {
  let pageRequests: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    pageRequests = [];
    stubNetwork(pageRequests);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a mid-crawl link to http://127.0.0.1:3000/ without requesting it", async () => {
    const page = await crawlPage("http://127.0.0.1:3000/", 1, false);

    expect(page).toMatchObject({ statusCode: 0, fetchClass: "error" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a page whose host now resolves to a private address", async () => {
    const page = await crawlPage("https://rebound.example.com/about", 2, true);

    expect(page).toMatchObject({ statusCode: 0, fetchClass: "error" });
    expect(pageRequests).toEqual([]);
  });
});
