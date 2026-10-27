import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CRON_EXPRESSIONS, handleCronTrigger } from "./cron-trigger";

// getEnvValueSync reads process.env first; only the env passed in may count.
delete process.env.CRON_TRIGGER_SECRET;

const secret = "s".repeat(40);
const env = { CRON_TRIGGER_SECRET: secret };

function post(cron: string, token = secret, method = "POST") {
  return new Request(
    `http://127.0.0.1:3601/internal/cron?cron=${encodeURIComponent(cron)}`,
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

  it("reports a failed run as 500 so the host timer records a failure", async () => {
    const run = vi.fn().mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleCronTrigger(post("17 3 * * *"), env, run);
    expect(res.status).toBe(500);
  });

  it("refuses a wrong or longer secret, an unknown cron and GET", async () => {
    const run = vi.fn();
    const status = async (request: Request) =>
      (await handleCronTrigger(request, env, run)).status;
    expect(await status(post("*/5 * * * *", "x".repeat(40)))).toBe(401);
    expect(await status(post("*/5 * * * *", `${secret}x`))).toBe(401);
    expect(await status(post("* * * * *"))).toBe(400);
    expect(await status(post("*/5 * * * *", secret, "GET"))).toBe(405);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not exist without a secret of at least 32 characters", async () => {
    const run = vi.fn();
    const short = "s".repeat(31);
    for (const candidate of [{}, { CRON_TRIGGER_SECRET: short }]) {
      const res = await handleCronTrigger(
        post("*/5 * * * *", short),
        candidate,
        run,
      );
      expect(res.status).toBe(404);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("does not exist for requests that came through the public proxy", async () => {
    const run = vi.fn();
    for (const header of ["x-forwarded-for", "x-real-ip"]) {
      const request = post("*/5 * * * *");
      request.headers.set(header, "203.0.113.9");
      expect((await handleCronTrigger(request, env, run)).status).toBe(404);
    }
    expect(run).not.toHaveBeenCalled();
  });

  // A drifted expression fails silently: the timer gets 400 and nothing runs.
  it("allows exactly the wrangler.jsonc crons, and the box timers send them", () => {
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    const crons = /"crons":\s*\[([^\]]*)\]/.exec(wrangler)?.[1] ?? "";
    expect([...crons.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([
      ...CRON_EXPRESSIONS,
    ]);

    const timerCrons = [
      "deploy/optimize/lunar-optimize-cron.service",
      "deploy/optimize/lunar-optimize-cron-daily.service",
    ].map(
      (unit) =>
        /^ExecStart=\S+ "([^"]+)"$/m.exec(readFileSync(unit, "utf8"))?.[1],
    );
    expect(timerCrons).toEqual([...CRON_EXPRESSIONS]);
  });
});
