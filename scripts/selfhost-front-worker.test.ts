import { describe, expect, it, vi } from "vitest";
import front, { isHostAllowed } from "./selfhost-front-worker";

function appService() {
  const fetch = vi.fn(async (_request: Request) => new Response("app"));
  const scheduled = vi.fn(async () => ({ outcome: "ok" }));
  // Only the members the front worker calls.
  return { fetch, scheduled } as unknown as Fetcher & {
    fetch: typeof fetch;
    scheduled: typeof scheduled;
  };
}

// The handler takes the runtime's incoming-request type; tests build plain ones.
function incoming(url: string, headers: Record<string, string>) {
  return new Request(url, { headers }) as Parameters<typeof front.fetch>[0];
}

describe("self-host front worker", () => {
  it("allows what vite preview allowed", () => {
    const allowed = ["seo.example.com", ".tenant.example"];
    for (const host of [
      "127.0.0.1:3001",
      "[::1]:3001",
      "localhost:3001",
      "open-seo.localhost",
      "seo.example.com",
      "a.tenant.example",
      "tenant.example",
    ]) {
      expect(isHostAllowed(host, allowed)).toBe(true);
    }
    for (const host of [
      "evil.example",
      "seo.example.com.evil.example",
      "[nope]",
    ]) {
      expect(isHostAllowed(host, allowed)).toBe(false);
    }
  });

  it("blocks a host outside the allowlist before it reaches the app", async () => {
    const APP = appService();
    const response = await front.fetch(
      incoming("http://evil.example/", { host: "evil.example" }),
      { APP, ALLOWED_HOST: "seo.example.com" },
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Blocked request");
    expect(APP.fetch).not.toHaveBeenCalled();
  });

  it("gives the app the forwarded protocol and a default X-Forwarded-Host", async () => {
    const APP = appService();
    await front.fetch(
      incoming("http://seo.example.com/p/1?x=1", {
        host: "seo.example.com",
        "x-forwarded-proto": "https",
      }),
      { APP, BETTER_AUTH_URL: "https://seo.example.com" },
    );
    const forwarded = APP.fetch.mock.calls[0][0];
    expect(forwarded.url).toBe("https://seo.example.com/p/1?x=1");
    expect(forwarded.headers.get("x-forwarded-host")).toBe("seo.example.com");
  });

  it("passes a cron trigger on to the app", async () => {
    const APP = appService();
    await front.scheduled(
      { cron: "*/5 * * * *", scheduledTime: 0, noRetry() {} },
      { APP },
    );
    expect(APP.scheduled).toHaveBeenCalledWith({
      cron: "*/5 * * * *",
      scheduledTime: new Date(0),
    });
  });
});
