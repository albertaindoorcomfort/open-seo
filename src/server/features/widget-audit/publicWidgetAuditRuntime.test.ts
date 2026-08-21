import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { createWidgetAuditSearchGateway } from "@/server/features/widget-audit/publicWidgetAuditRuntime";

class MemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }
}

const fixedNow = new Date("2026-08-20T12:00:00.000Z");

function request() {
  return new Request("https://app.openseo.so/api/widget/audit", {
    method: "POST",
    headers: { "cf-connecting-ip": "192.0.2.10" },
  });
}

describe("widget audit runtime gateway", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fails closed in hosted mode until an explicit daily limit is configured", async () => {
    const gateway = createWidgetAuditSearchGateway({
      runtimeEnv: {
        AUTH_MODE: "hosted",
        BETTER_AUTH_URL: "https://app.openseo.so",
        TURNSTILE_SECRET_KEY: "secret",
        KV: new MemoryKv(),
      },
      now: () => fixedNow,
      fetchProvider: vi.fn(),
      verifyTurnstile: vi.fn(async () => ({
        success: true,
        action: "public_widget_audit",
        hostname: "app.openseo.so",
      })),
    });

    await expect(
      gateway({
        domain: "example.com",
        request: request(),
        turnstileToken: "token",
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "SERVICE_NOT_CONFIGURED",
    });
  });

  it("requires successful Turnstile verification in hosted mode", async () => {
    const fetchProvider = vi.fn();
    const gateway = createWidgetAuditSearchGateway({
      runtimeEnv: {
        AUTH_MODE: "hosted",
        BETTER_AUTH_URL: "https://app.openseo.so",
        TURNSTILE_SECRET_KEY: "secret",
        WIDGET_AUDIT_DAILY_CALL_LIMIT: "25",
        KV: new MemoryKv(),
      },
      now: () => fixedNow,
      fetchProvider,
      verifyTurnstile: vi.fn(async () => ({
        success: false,
        action: null,
        hostname: null,
      })),
    });

    await expect(
      gateway({
        domain: "example.com",
        request: request(),
        turnstileToken: "invalid",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "HUMAN_VERIFICATION_FAILED",
    });
    expect(fetchProvider).not.toHaveBeenCalled();
  });

  it("binds a valid Turnstile token to the public-audit action and app hostname", async () => {
    const fetchProvider = vi.fn();
    const gateway = createWidgetAuditSearchGateway({
      runtimeEnv: {
        AUTH_MODE: "hosted",
        BETTER_AUTH_URL: "https://app.openseo.so",
        TURNSTILE_SECRET_KEY: "secret",
        WIDGET_AUDIT_DAILY_CALL_LIMIT: "25",
        KV: new MemoryKv(),
      },
      now: () => fixedNow,
      fetchProvider,
      verifyTurnstile: vi.fn(async () => ({
        success: true,
        action: "sign_up",
        hostname: "customer.example",
      })),
    });

    await expect(
      gateway({
        domain: "example.com",
        request: request(),
        turnstileToken: "valid-but-wrong-context",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "HUMAN_VERIFICATION_FAILED",
    });
    expect(fetchProvider).not.toHaveBeenCalled();
  });

  it("caches real provider estimates and does not spend a second provider call", async () => {
    const kv = new MemoryKv();
    const fetchProvider = vi.fn(async () => ({
      data: [
        {
          metrics: {
            organic: { etv: 321.4, count: 44.6 },
          },
        },
      ],
    }));
    const gateway = createWidgetAuditSearchGateway({
      runtimeEnv: {
        AUTH_MODE: "local_noauth",
        WIDGET_AUDIT_DAILY_CALL_LIMIT: "25",
        KV: kv,
      },
      now: () => fixedNow,
      fetchProvider,
      verifyTurnstile: vi.fn(async () => ({
        success: true,
        action: "public_widget_audit",
        hostname: "app.openseo.so",
      })),
    });

    const first = await gateway({
      domain: "example.com",
      request: request(),
    });
    const second = await gateway({
      domain: "example.com",
      request: request(),
    });

    expect(first).toMatchObject({
      organicTraffic: 321,
      organicKeywords: 45,
      sourceClass: "estimated",
      locationLabel: "Canada",
    });
    expect(second).toEqual(first);
    expect(fetchProvider).toHaveBeenCalledOnce();
    expect(kv.values.get("widget-audit:daily:2026-08-20")).toBe("1");
  });

  it("enforces the configured daily provider-call limit", async () => {
    const kv = new MemoryKv();
    kv.values.set("widget-audit:daily:2026-08-20", "1");
    const fetchProvider = vi.fn();
    const gateway = createWidgetAuditSearchGateway({
      runtimeEnv: {
        AUTH_MODE: "local_noauth",
        WIDGET_AUDIT_DAILY_CALL_LIMIT: "1",
        KV: kv,
      },
      now: () => fixedNow,
      fetchProvider,
      verifyTurnstile: vi.fn(async () => ({
        success: true,
        action: "public_widget_audit",
        hostname: "app.openseo.so",
      })),
    });

    await expect(
      gateway({ domain: "example.com", request: request() }),
    ).rejects.toMatchObject({
      status: 429,
      code: "DAILY_LIMIT_REACHED",
    });
    expect(fetchProvider).not.toHaveBeenCalled();
  });
});
