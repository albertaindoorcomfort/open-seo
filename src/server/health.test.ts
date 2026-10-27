import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleHealthRequest } from "./health";

// The database probe runs through drizzle against a real in-memory SQLite, so
// the test sees exactly the query the app sends.
const sqlite = vi.hoisted(() => ({ database: null as DatabaseSync | null }));

function sqlValue(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  throw new Error("Unexpected SQL parameter type in health test.");
}

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  return {
    db: drizzle((sql, params: unknown[]) => {
      const database = sqlite.database;
      if (!database) throw new Error("no database");
      const rows = database
        .prepare(sql)
        .all(...params.map(sqlValue))
        .map((row) => Object.values(row));
      return Promise.resolve({ rows });
    }),
  };
});

// getEnvValueSync reads process.env first; only the env passed in may count.
for (const name of [
  "DATAFORSEO_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "OPENROUTER_API_KEY",
]) {
  delete process.env[name];
}

const up = {
  KV: { get: () => Promise.resolve(null) },
  R2: { head: () => Promise.resolve(null) },
};

function get(path: string, env: object, method = "GET") {
  return handleHealthRequest(
    new Request(`http://127.0.0.1:3601${path}`, { method }),
    env,
  );
}

describe("health endpoints", () => {
  beforeEach(() => {
    sqlite.database = new DatabaseSync(":memory:");
    sqlite.database.exec("create table projects (id text primary key)");
  });

  it("is ready when the app tables, KV and storage answer", async () => {
    expect((await get("/health/ready", up)).status).toBe(200);
    expect((await get("/health/live", up)).status).toBe(200);
  });

  it("is not ready on an unmigrated database, while live stays 200", async () => {
    sqlite.database = new DatabaseSync(":memory:");
    expect((await get("/health/ready", up)).status).toBe(503);
    expect((await get("/health/live", up)).status).toBe(200);
  });

  it("is not ready when KV is missing or storage fails", async () => {
    expect((await get("/health/ready", { R2: up.R2 })).status).toBe(503);
    const brokenStorage = {
      ...up,
      R2: { head: () => Promise.reject(new Error("gone")) },
    };
    expect((await get("/health/ready", brokenStorage)).status).toBe(503);
  });

  it("lists dependencies by service name, never env var names or values", async () => {
    const res = await get("/health/dependencies", {
      ...up,
      DATAFORSEO_API_KEY: "value-dfs",
      GOOGLE_CLIENT_ID: "value-gid",
      OPENROUTER_API_KEY: "value-llm",
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('"seo_data_provider"');
    expect(text).toContain('"google_oauth"');
    expect(text).not.toMatch(/[A-Z]{2,}_[A-Z_]+|value-/);
  });

  it("refuses other methods", async () => {
    expect((await get("/health/ready", up, "POST")).status).toBe(405);
  });
});
