import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverUrls } from "@/server/lib/audit/discovery";

const redirects: Record<string, string> = {
  "https://example.com/robots.txt": "http://127.0.0.1:3000/robots.txt",
  "https://example.com/sitemap.xml": "http://169.254.169.254/latest/meta-data/",
};

/** A fake network that, like fetch(), follows redirects unless told not to. */
function fakeFetch(requested: string[]) {
  const respond = async (
    input: string,
    init?: RequestInit,
  ): Promise<Response> => {
    if (input.startsWith("https://cloudflare-dns.com/")) {
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.215.14" }],
      });
    }
    requested.push(input);
    const location = redirects[input];
    if (!location) return new Response("internal", { status: 200 });
    if (init?.redirect === "manual") {
      return new Response(null, { status: 302, headers: { location } });
    }
    return respond(location, init);
  };
  return respond;
}

describe("discoverUrls SSRF guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not follow robots.txt or sitemap redirects into private addresses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(fakeFetch(requested)));

    const result = await discoverUrls("https://example.com");

    expect(result).toEqual({ urls: [], robotsText: null });
    expect(requested).toEqual(Object.keys(redirects));
  });
});
