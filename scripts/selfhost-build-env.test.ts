import { describe, expect, it } from "vitest";
import {
  buildEnvRecord,
  diffBuildEnv,
  mismatchMessage,
} from "./selfhost-build-env";

describe("build-time env check", () => {
  it("records only the names vite inlines, treating empty as unset", () => {
    const record = buildEnvRecord({
      VITE_BRAND: "aic",
      VITE_BRAND_SUPPORT_EMAIL: "",
      AUTH_MODE: "local_noauth",
      DATAFORSEO_API_KEY: "runtime-only",
      PORT: "3001",
    });
    expect(Object.keys(record)).toEqual(["AUTH_MODE", "VITE_BRAND"]);
  });

  it("matches a container that sets the same values, or leaves unset ones empty", () => {
    const built = buildEnvRecord({ VITE_BRAND: "aic" });
    const current = buildEnvRecord({
      VITE_BRAND: "aic",
      VITE_BRAND_SUPPORT_EMAIL: "",
    });
    expect(diffBuildEnv(built, current)).toEqual([]);
  });

  it("names each differing variable and never prints a value", () => {
    const built = buildEnvRecord({
      VITE_BRAND: "aic",
      AUTH_MODE: "local_noauth",
      POSTHOG_HOST: "https://built.example",
    });
    const current = buildEnvRecord({
      AUTH_MODE: "local_noauth",
      POSTHOG_HOST: "https://runtime.example",
      TURNSTILE_SITE_KEY: "site-key-value",
    });
    const problems = diffBuildEnv(built, current);
    expect(problems.map(({ name }) => name)).toEqual([
      "POSTHOG_HOST",
      "TURNSTILE_SITE_KEY",
      "VITE_BRAND",
    ]);
    const message = mismatchMessage(problems);
    expect(message).toContain(
      '--build-arg POSTHOG_HOST="$POSTHOG_HOST" --build-arg TURNSTILE_SITE_KEY="$TURNSTILE_SITE_KEY"',
    );
    for (const value of [
      "aic",
      "built.example",
      "runtime.example",
      "site-key-value",
    ]) {
      expect(message).not.toContain(value);
    }
  });
});
