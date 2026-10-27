import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: {} as Record<string, string | undefined>,
}));

vi.mock("cloudflare:workers", () => ({ env: envMock }));

import { getSamAccessStatus } from "@/server/features/sam/samAccess";

describe("getSamAccessStatus", () => {
  beforeEach(() => {
    // The shell may carry live keys; process.env wins over the worker env.
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AUTH_MODE;
    envMock.AUTH_MODE = "hosted";
    envMock.OPENROUTER_API_KEY = undefined;
  });

  it("keeps SAM off in hosted mode without a model key", async () => {
    // Regression: hosted mode reported SAM enabled without checking the key,
    // and every turn then threw.
    await expect(getSamAccessStatus()).resolves.toEqual({
      enabled: false,
      errorMessage: null,
    });
  });

  it("turns SAM on once a model key is set", async () => {
    envMock.OPENROUTER_API_KEY = "test-key";
    await expect(getSamAccessStatus()).resolves.toEqual({
      enabled: true,
      errorMessage: null,
    });
  });
});
