import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "@/server/lib/errors";

// The real gate chain: AuditService -> subscription -> autumn facade ->
// placeholder ledger. Only the runtime around it is faked.
const { env } = vi.hoisted(() => ({
  env: {
    LUNAR_OPTIMIZE_PLACEHOLDER_MANAGED_ACCESS: undefined as string | undefined,
    KV: { get: async () => null, put: async () => undefined },
  },
}));

vi.mock("cloudflare:workers", () => ({ env }));
// Hosted, with no AUTUMN_SECRET_KEY: billing is the placeholder ledger and
// sign-up is invite-only, so every organization here was invited.
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => true,
  getOptionalEnvValue: async () => undefined,
}));
vi.mock("@/server/lib/posthog", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {},
}));
vi.mock("@/server/features/audit/AuditScratchpad", () => ({
  getAuditScratchpad: vi.fn(),
}));
vi.mock("@/server/lib/audit/progress-kv", () => ({ AuditProgressKV: {} }));

import { AuditService } from "@/server/features/audit/services/AuditService";

describe("site audit gate on the placeholder ledger (D1)", () => {
  beforeEach(() => {
    env.LUNAR_OPTIMIZE_PLACEHOLDER_MANAGED_ACCESS = undefined;
  });

  it("lets an invited organization run site audits by default", async () => {
    await expect(
      AuditService.resolveAuditLimitTier("org_invited"),
    ).resolves.toBe("paid");
  });

  it("refuses audits again when LUNAR_OPTIMIZE_PLACEHOLDER_MANAGED_ACCESS is off", async () => {
    env.LUNAR_OPTIMIZE_PLACEHOLDER_MANAGED_ACCESS = "off";

    await expect(
      AuditService.resolveAuditLimitTier("org_invited"),
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    } satisfies Partial<AppError>);
  });
});
