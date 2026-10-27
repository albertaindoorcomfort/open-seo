import { describe, expect, it, vi } from "vitest";
import { handleCronTrigger } from "./cron-trigger";

const secret = "s".repeat(40);
const env = { CRON_TRIGGER_SECRET: secret };

function post(cron: string, token = secret, method = "POST") {
  return new Request(
    `https://seo.example/internal/cron?cron=${encodeURIComponent(cron)}`,
    { method, headers: { authorization: `Bearer ${token}` } },
  );
}

describe("cron trigger", () => {
  it("runs a known cron with the right secret", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const res = await handleCronTrigger(post("*/5 * * * *"), env, run);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith("*/5 * * * *");
  });

  it("refuses a wrong secret, an unknown cron and GET", async () => {
    const run = vi.fn();
    expect(
      (await handleCronTrigger(post("*/5 * * * *", "x".repeat(40)), env, run))
        .status,
    ).toBe(401);
    expect((await handleCronTrigger(post("* * * * *"), env, run)).status).toBe(
      400,
    );
    expect(
      (await handleCronTrigger(post("*/5 * * * *", secret, "GET"), env, run))
        .status,
    ).toBe(405);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not exist without a long enough secret", async () => {
    const res = await handleCronTrigger(
      post("*/5 * * * *", "short"),
      { CRON_TRIGGER_SECRET: "short" },
      vi.fn(),
    );
    expect(res.status).toBe(404);
  });
});
