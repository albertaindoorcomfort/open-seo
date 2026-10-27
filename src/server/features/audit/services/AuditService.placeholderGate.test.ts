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

  it("lets an invited organization run site audits by default, on the placeholder tier", async () => {
    await expect(
      AuditService.resolveAuditLimitTier("org_invited"),
    ).resolves.toBe("placeholder");
  });

  it("refuses audits for off and for any value it does not recognise", async () => {
    for (const value of ["off", "disabled", "n"]) {
      env.LUNAR_OPTIMIZE_PLACEHOLDER_MANAGED_ACCESS = value;
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(
        AuditService.resolveAuditLimitTier("org_invited"),
        value,
      ).rejects.toMatchObject({
        code: "PAYMENT_REQUIRED",
      } satisfies Partial<AppError>);
    }
  });
});
