import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  backlinkSnapshots,
  projects,
  rankTrackingConfigs,
  rankTrackingKeywords,
} from "@/db/schema";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { RankTrackingService } from "@/server/features/rank-tracking/services/RankTrackingService";
import { productionSearchGateway } from "@/server/features/widget-audit/publicWidgetAuditRuntime";
import { fetchSerpLocationsForCountry } from "@/server/lib/dataforseo/serp-locations";

// With no DataForSEO key every call answers with sample data. These tests run
// each place that used to store it against the real migrated schema and a KV
// store, and prove no sample row reaches them.

const stores = await vi.hoisted(async () => {
  // Sample mode only: no live provider key, and self-hosted metering (no
  // billing provider) so nothing here can spend money.
  Reflect.deleteProperty(process.env, "DATAFORSEO_API_KEY");
  Reflect.deleteProperty(process.env, "AUTH_MODE");
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const client = createClient({ url: "file::memory:" });
  const kv = new Map<string, string>();
  return {
    client,
    db: drizzle(client),
    kv,
    kvBinding: {
      get: async (key: string, options?: { type?: string }) => {
        const value = kv.get(key) ?? null;
        if (value === null || options?.type !== "json") return value;
        const parsed: unknown = JSON.parse(value);
        return parsed;
      },
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
    },
  };
});

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1", KV: stores.kvBinding },
}));
vi.mock("@/db", () => ({ db: stores.db }));
vi.mock("@/db/d1/client", () => ({ d1Db: stores.db }));

const customer = {
  organizationId: "org_1",
  userId: "user_1",
  userEmail: "owner@acme.test",
};

beforeAll(async () => {
  await migrate(stores.db, {
    migrationsFolder: fileURLToPath(
      new URL("../../../../drizzle", import.meta.url),
    ),
  });
  // Parent rows (organization, user) are not what these tests are about.
  await stores.client.execute("PRAGMA foreign_keys = OFF");
  await stores.db.insert(projects).values({
    id: "project_1",
    organizationId: "org_1",
    name: "Acme",
    domain: "acme.com",
    locationCode: 2124,
  });
  await stores.db.insert(rankTrackingConfigs).values({
    id: "config_1",
    projectId: "project_1",
    domain: "acme.com",
    locationCode: 2124,
    serpDepth: 20,
  });
  await stores.db.insert(rankTrackingKeywords).values([
    { id: "kw_1", configId: "config_1", keyword: "heat pump" },
    { id: "kw_2", configId: "config_1", keyword: "furnace repair" },
  ]);
});

describe("sample data is never stored", () => {
  it("rank metrics refresh writes no sample volume, KD or CPC to rank_tracking_keywords", async () => {
    await expect(
      RankTrackingService.refreshKeywordMetrics(
        "config_1",
        "project_1",
        customer,
      ),
    ).resolves.toEqual({ updated: 0 });

    const rows = await stores.db
      .select({
        searchVolume: rankTrackingKeywords.searchVolume,
        keywordDifficulty: rankTrackingKeywords.keywordDifficulty,
        cpc: rankTrackingKeywords.cpc,
        metricsFetchedAt: rankTrackingKeywords.metricsFetchedAt,
      })
      .from(rankTrackingKeywords);
    const untouched = {
      searchVolume: null,
      keywordDifficulty: null,
      cpc: null,
      metricsFetchedAt: null,
    };
    expect(rows).toEqual([untouched, untouched]);
  });

  it("the dashboard backlink refresh shows labelled sample numbers and writes no backlink_snapshots row", async () => {
    const summary = await DashboardService.ensureBacklinkSnapshot({
      projectId: "project_1",
      domain: "acme.com",
      billingCustomer: customer,
    });

    expect(summary).toMatchObject({ domain: "acme.com", sample: true });
    expect(summary?.backlinks).toBeGreaterThan(0);
    expect(await stores.db.select().from(backlinkSnapshots)).toEqual([]);
  });

  it("the city picker caches no sample list under KV serp-locations:*", async () => {
    await expect(fetchSerpLocationsForCountry("ca")).resolves.toEqual([]);

    expect(
      [...stores.kv.keys()].filter((key) => key.startsWith("serp-locations:")),
    ).toEqual([]);
  });

  it("the public widget refuses sample data and caches no sample result under KV widget-audit:search:*", async () => {
    await expect(
      productionSearchGateway({
        domain: "acme.com",
        request: new Request("https://optimize.test/api/widget/audit"),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const cached = [...stores.kv]
      .filter(([key]) => key.startsWith("widget-audit:search:"))
      .map(([, value]) => value);
    expect(cached).toEqual([JSON.stringify({ kind: "provider_error" })]);
  });
});
