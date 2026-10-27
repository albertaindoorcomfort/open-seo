import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpResponse, withSampleNotice } from "./formatters";

describe("mcpResponse", () => {
  it("returns content as a text block", () => {
    const result = mcpResponse({ text: "hi" });
    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("includes _meta only when meta is provided", () => {
    const bare = mcpResponse({ text: "hi" });
    expect(bare._meta).toBeUndefined();

    const withMeta = mcpResponse({
      text: "hi",
      meta: { url: "https://app.openseo.so/p/1", projectId: "1" },
    });
    expect(withMeta._meta).toEqual({
      url: "https://app.openseo.so/p/1",
      projectId: "1",
    });
  });

  it("drops undefined meta keys", () => {
    const result = mcpResponse({
      text: "hi",
      meta: {
        url: "https://app.openseo.so",
        organizationId: undefined,
        creditsCharged: 0,
      },
    });
    expect(result._meta).toEqual({
      url: "https://app.openseo.so",
      creditsCharged: 0,
    });
    expect(result._meta).not.toHaveProperty("organizationId");
  });

  it("attaches structuredContent when provided", () => {
    const result = mcpResponse({
      text: "hi",
      structuredContent: { foo: "bar" },
    });
    expect(result.structuredContent).toEqual({ foo: "bar" });
  });

  it("mirrors metadata into structuredContent for clients that hide _meta", () => {
    const result = mcpResponse({
      text: "hi",
      meta: {
        url: "https://app.openseo.so/p/1",
        projectId: "1",
        creditsRemaining: 100,
      },
      structuredContent: { foo: "bar" },
    });

    expect(result.structuredContent).toEqual({
      foo: "bar",
      meta: {
        url: "https://app.openseo.so/p/1",
        projectId: "1",
        creditsRemaining: 100,
      },
    });
    expect(result._meta).toEqual({
      url: "https://app.openseo.so/p/1",
      projectId: "1",
      creditsRemaining: 100,
    });
  });

  it("uses metadata as structuredContent when no data payload is provided", () => {
    const result = mcpResponse({
      text: "hi",
      meta: { url: "https://app.openseo.so" },
    });

    expect(result.structuredContent).toEqual({
      meta: { url: "https://app.openseo.so" },
    });
  });
});

describe("withSampleNotice", () => {
  afterEach(() => vi.unstubAllEnvs());

  // An empty value reads as no key (sample mode); the key here is fake.
  it.each([
    { key: "", notice: true },
    { key: "fake-test-key", notice: false },
  ])(
    'puts the sample notice first exactly while DataForSEO answers with sample data (key: "$key")',
    async ({ key, notice }) => {
      vi.stubEnv("DATAFORSEO_API_KEY", key);
      const result = await withSampleNotice(mcpResponse({ text: "hi" }));

      const texts = (result.content ?? []).map((part) =>
        part.type === "text" ? part.text : "",
      );
      expect(texts.length).toBe(notice ? 2 : 1);
      expect(texts[0].startsWith("Sample data:")).toBe(notice);
      expect(texts.at(-1)).toBe("hi");
    },
  );
});
