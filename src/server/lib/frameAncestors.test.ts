import { describe, expect, it } from "vitest";
import { frameAncestorsPolicy } from "./frameAncestors";

describe("frameAncestorsPolicy", () => {
  it("adds only bare https origins to 'self'", () => {
    expect(frameAncestorsPolicy(undefined)).toBe("frame-ancestors 'self'");
    expect(
      frameAncestorsPolicy(
        "https://portal.example.com/ http://plain.example.com * https://*.example.com https://a.example.com/path https://u:p@b.example.com junk https://portal.example.com",
      ),
    ).toBe("frame-ancestors 'self' https://portal.example.com");
  });
});
