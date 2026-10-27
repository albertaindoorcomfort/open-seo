import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "@/server/lib/errors";
import {
  assertPublicUrl,
  guardedFetch,
  isPublicAddress,
} from "@/server/lib/ssrf-guard";

const blocked = { code: "CRAWL_TARGET_BLOCKED" } satisfies Partial<AppError>;
const PUBLIC_V4 = "93.184.215.14";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ssrf guard", () => {
  it("accepts only public unicast addresses", () => {
    const refused = [
      "127.0.0.1",
      "127.255.255.254",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "100.100.100.200",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:8.8.8.8",
      "::7f00:1",
      "64:ff9b::7f00:1",
      "fd00:ec2::254",
      "fc00::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      "2001:db8::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "2002:7f00:1::1",
      "not-an-address",
    ];
    const accepted = [PUBLIC_V4, "8.8.8.8", "172.32.0.1", "2606:4700::1111"];

    expect(refused.filter(isPublicAddress)).toEqual([]);
    expect(accepted.filter((address) => !isPublicAddress(address))).toEqual([]);
  });

  it("refuses loopback, private and metadata URLs in every spelling, before any lookup", async () => {
    const resolve = vi.fn(async () => [PUBLIC_V4]);
    const urls = [
      "http://127.0.0.1:3000/",
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "http://017700000001/",
      "http://127.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00:ec2::254]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost/",
      "http://studio.localhost/",
      "http://metadata.google.internal/",
      "http://intranet/",
      "https://example.com:3000/",
      "ftp://example.com/",
      "file:///etc/passwd",
    ];

    for (const url of urls) {
      await expect(assertPublicUrl(url, resolve), url).rejects.toMatchObject(
        blocked,
      );
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a public-looking name that resolves to a private address", async () => {
    await expect(
      assertPublicUrl("https://rebind.example.com/", async () => [
        PUBLIC_V4,
        "127.0.0.1",
      ]),
    ).rejects.toMatchObject(blocked);
    await expect(
      assertPublicUrl("https://example.com/", async () => [PUBLIC_V4]),
    ).resolves.toBeInstanceOf(URL);
  });

  it("fails closed when a name has no address or the lookup fails", async () => {
    await expect(
      assertPublicUrl("https://nothing.example.com/", async () => []),
    ).rejects.toMatchObject(blocked);
    await expect(
      assertPublicUrl("https://down.example.com/", async () => {
        throw new Error("resolver down");
      }),
    ).rejects.toMatchObject(blocked);
  });

  it("asks DNS over HTTPS by default and refuses a loopback answer", async () => {
    const answers: Record<string, unknown> = {
      A: { Status: 0, Answer: [{ type: 1, data: "127.0.0.1" }] },
      AAAA: { Status: 0 },
    };
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        requested.push(input);
        const type = new URL(input).searchParams.get("type") ?? "";
        return Response.json(answers[type]);
      }),
    );

    await expect(
      assertPublicUrl("https://loopback-dns.example.com/"),
    ).rejects.toMatchObject(blocked);
    expect(requested.map((url) => new URL(url).origin)).toEqual([
      "https://cloudflare-dns.com",
      "https://cloudflare-dns.com",
    ]);
  });

  it("retries a failed DNS over HTTPS answer once before it refuses", async () => {
    let failuresLeft = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const type = new URL(input).searchParams.get("type");
        if (type === "A" && failuresLeft-- > 0) {
          return new Response("busy", { status: 503 });
        }
        return Response.json(
          type === "A"
            ? { Status: 0, Answer: [{ type: 1, data: PUBLIC_V4 }] }
            : { Status: 0 },
        );
      }),
    );

    await expect(
      assertPublicUrl("https://blip.example.com/"),
    ).resolves.toBeInstanceOf(URL);
  });

  it("checks each redirect hop before requesting it", async () => {
    const resolve = async (host: string) =>
      host === "intranet.example.com" ? ["10.0.0.5"] : [PUBLIC_V4];
    const hops: Record<string, string> = {
      "https://example.com/a": "http://127.0.0.1:3000/",
      "https://example.com/b": "https://intranet.example.com/",
    };
    // Like fetch(), the fake follows a redirect itself unless told not to.
    const requested: string[] = [];
    const respond = async (
      input: string,
      init?: RequestInit,
    ): Promise<Response> => {
      requested.push(input);
      const location = hops[input];
      if (!location) return new Response("internal");
      if (init?.redirect === "manual") {
        return new Response(null, { status: 302, headers: { location } });
      }
      return respond(location, init);
    };
    vi.stubGlobal("fetch", vi.fn(respond));

    for (const start of Object.keys(hops)) {
      await expect(
        guardedFetch(start, {}, { maxRedirects: 5, resolve }),
      ).rejects.toMatchObject(blocked);
    }
    expect(requested).toEqual(Object.keys(hops));
  });
});
