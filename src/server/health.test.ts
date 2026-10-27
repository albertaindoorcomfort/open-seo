import { describe, expect, it } from "vitest";
import { handleHealthRequest } from "./health";

const up = {
  DB: { prepare: () => ({ first: () => Promise.resolve({ 1: 1 }) }) },
  KV: { get: () => Promise.resolve(null) },
  R2: { head: () => Promise.resolve(null) },
};

function get(path: string, env: object, method = "GET") {
  return handleHealthRequest(
    new Request(`https://seo.example${path}`, { method }),
    env,
  );
}

describe("health endpoints", () => {
  it("is ready when the database, KV and storage answer", async () => {
    const res = await get("/health/ready", up);
    expect(res.status).toBe(200);
  });

  it("returns 503 on ready when the database is down", async () => {
    const env = {
      ...up,
      DB: {
        prepare: () => ({ first: () => Promise.reject(new Error("gone")) }),
      },
    };
    expect((await get("/health/ready", env)).status).toBe(503);
    expect((await get("/health/live", env)).status).toBe(200);
  });

  it("lists dependencies by service name without env var names", async () => {
    const res = await get("/health/dependencies", {
      ...up,
      DATAFORSEO_API_KEY: "x",
    });
    const text = await res.text();
    expect(text).toContain("seo_data_provider");
    expect(text).not.toMatch(/DATAFORSEO|API_KEY|GOOGLE_/);
  });

  it("refuses other methods", async () => {
    expect((await get("/health/ready", up, "POST")).status).toBe(405);
  });
});
