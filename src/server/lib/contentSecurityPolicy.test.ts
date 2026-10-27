import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contentSecurityPolicy,
  withContentSecurityPolicy,
} from "./contentSecurityPolicy";

function directive(policy: string | null, name: string) {
  return policy?.split("; ").find((entry) => entry.startsWith(`${name} `));
}

describe("withContentSecurityPolicy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives each HTML document the nonce its handler rendered with", async () => {
    vi.stubEnv("OPEN_SEO_FRAME_ANCESTORS", "https://portal.example.com");
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("POSTHOG_HOST", "");
    const nonces: string[] = [];
    const appFetch = withContentSecurityPolicy((_request, { context }) => {
      nonces.push(context.nonce);
      return new Response("<html></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });

    const first = await appFetch(new Request("https://app.test/"));
    const second = await appFetch(new Request("https://app.test/"));
    const policy = first.headers.get("content-security-policy");

    expect(nonces[0]).not.toBe(nonces[1]);
    expect(directive(policy, "script-src")).toBe(
      `script-src 'self' 'nonce-${nonces[0]}'`,
    );
    expect(directive(policy, "frame-ancestors")).toBe(
      "frame-ancestors 'self' https://portal.example.com",
    );
    expect(second.headers.get("content-security-policy")).toContain(
      `'nonce-${nonces[1]}'`,
    );
  });

  it("leaves non-HTML responses and a route's own policy alone", async () => {
    const json = withContentSecurityPolicy(() => Response.json({ ok: true }));
    const own = withContentSecurityPolicy(
      () =>
        new Response("<html></html>", {
          headers: {
            "content-type": "text/html",
            "content-security-policy": "default-src 'none'",
          },
        }),
    );

    expect(
      (await json(new Request("https://app.test/x"))).headers.has(
        "content-security-policy",
      ),
    ).toBe(false);
    expect(
      (await own(new Request("https://app.test/y"))).headers.get(
        "content-security-policy",
      ),
    ).toBe("default-src 'none'");
  });
});

describe("contentSecurityPolicy", () => {
  it("allows Turnstile and PostHog hosts only when they are configured", () => {
    const base = { nonce: "n", frameAncestors: "frame-ancestors 'self'" };
    const configured = contentSecurityPolicy({
      ...base,
      turnstile: true,
      posthogHost: "https://us.i.posthog.com",
    });

    expect(directive(configured, "script-src")).toBe(
      "script-src 'self' 'nonce-n' https://challenges.cloudflare.com https://*.posthog.com",
    );
    expect(directive(configured, "frame-src")).toBe(
      "frame-src 'self' https://challenges.cloudflare.com",
    );
    expect(directive(configured, "connect-src")).toBe(
      "connect-src 'self' https://*.posthog.com",
    );
    expect(directive(contentSecurityPolicy(base), "connect-src")).toBe(
      "connect-src 'self'",
    );
  });
});
