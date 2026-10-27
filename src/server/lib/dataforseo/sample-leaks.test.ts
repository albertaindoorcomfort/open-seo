import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  backlinkSnapshots,
  keywordMetrics,
  projects,
  rankTrackingConfigs,
  rankTrackingKeywords,
  savedKeywords,
} from "@/db/schema";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { KeywordResearchService } from "@/server/features/keywords/services/KeywordResearchService";
import { RankTrackingService } from "@/server/features/rank-tracking/services/RankTrackingService";
import { productionSearchGateway } from "@/server/features/widget-audit/publicWidgetAuditRuntime";
import { trackDataforseoSample } from "@/server/lib/dataforseo/sample-scope";
import { fetchSerpLocationsForCountry } from "@/server/lib/dataforseo/serp-locations";
import { saveKeywordsSchema } from "@/types/schemas/keywords";

// Every place that used to store sample data, run against the real migrated
// schema and a KV store, in both ways DataForSEO answers with sample data: no
// key at all, and a key DataForSEO refuses for credits. With a key only the
// per-request scope can tell the answer was sample data, so the second mode is
// what proves the scope, not the key check, keeps it out of storage.

const stores = await vi.hoisted(async () => {
  // No live provider key from the shell, and self-hosted metering (no billing
  // provider), so nothing here can spend money.
  Reflect.deleteProperty(process.env, "DATAFORSEO_API_KEY");
  Reflect.deleteProperty(process.env, "AUTH_MODE");
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const client = createClient({ url: "file::memory:" });
  const kv = new Map<string, string>();
  const kvBinding = {
    get: async (key: string, options?: { type?: string }) => {
      const value = kv.get(key) ?? null;
      if (value === null || options?.type !== "json") return value;
      const parsed: unknown = JSON.parse(value);
      return parsed;
    },
    put: async (key: string, value: string) => {
      kv.set(key, value);
    },
  };
  return {
    client,
    db: drizzle(client),
    kv,
    // The Worker env each mode sets its key on.
    env: {
      DATABASE_PROVIDER: "d1",
      KV: kvBinding,
      DATAFORSEO_API_KEY: undefined as string | undefined,
    },
  };
});

vi.mock("cloudflare:workers", () => ({ env: stores.env }));
vi.mock("@/db", () => ({ db: stores.db }));
vi.mock("@/db/d1/client", () => ({ d1Db: stores.db }));

const customer = {
  organizationId: "org_1",
  userId: "user_1",
  userEmail: "owner@acme.test",
};

/** Runs `fn` as one server function call does: in its own request scope. */
async function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return (await trackDataforseoSample(fn)).value;
}

/** DataForSEO refusing a call for credits: HTTP 402 carrying task 40200. */
function creditsRefusal(): Response {
  return new Response(
    JSON.stringify({
      status_code: 40200,
      tasks: [{ status_code: 40200, status_message: "Payment Required." }],
    }),
    { status: 402, headers: { "content-type": "application/json" } },
  );
}

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
  await stores.db.insert(savedKeywords).values({
    id: "saved_1",
    projectId: "project_1",
    keyword: "furnace repair",
    locationCode: 2124,
    languageCode: "en",
  });
});

describe.each([
  { mode: "no DataForSEO key", key: undefined },
  // A fake value: every DataForSEO call is answered by the stub below.
  { mode: "a key DataForSEO refuses for credits", key: "fake-test-key" },
])("sample data is never stored, with $mode", ({ key }) => {
  const dataforseo = vi.fn(async () => creditsRefusal());

  beforeEach(() => {
    stores.env.DATAFORSEO_API_KEY = key;
    stores.kv.clear();
    vi.stubGlobal("fetch", dataforseo);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** With a key the sample data came from a refusal; with none DataForSEO was never asked. */
  function expectRefusalWhenKeyed() {
    expect(dataforseo.mock.calls.length > 0).toBe(key !== undefined);
  }

  it("rank metrics refresh writes no sample volume, KD or CPC to rank_tracking_keywords", async () => {
    await expect(
      inRequest(() =>
        RankTrackingService.refreshKeywordMetrics(
          "config_1",
          "project_1",
          customer,
        ),
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
    expectRefusalWhenKeyed();
  });

  it("the dashboard backlink refresh shows labelled sample numbers and writes no backlink_snapshots row", async () => {
    const summary = await inRequest(() =>
      DashboardService.ensureBacklinkSnapshot({
        projectId: "project_1",
        domain: "acme.com",
        billingCustomer: customer,
      }),
    );

    expect(summary).toMatchObject({ domain: "acme.com", sample: true });
    expect(summary?.backlinks).toBeGreaterThan(0);
    expect(await stores.db.select().from(backlinkSnapshots)).toEqual([]);
    expectRefusalWhenKeyed();
  });

  it("the city picker caches no sample list under KV serp-locations:*", async () => {
    await expect(
      inRequest(() => fetchSerpLocationsForCountry("ca")),
    ).resolves.toEqual([]);

    expect(
      [...stores.kv.keys()].filter((k) => k.startsWith("serp-locations:")),
    ).toEqual([]);
    expectRefusalWhenKeyed();
  });

  // An API route, not a server function: the widget opens its own scope.
  it("the public widget refuses sample data and caches no sample result under KV widget-audit:search:*", async () => {
    await expect(
      productionSearchGateway({
        domain: "acme.com",
        request: new Request("https://optimize.test/api/widget/audit"),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const cached = [...stores.kv]
      .filter(([k]) => k.startsWith("widget-audit:search:"))
      .map(([, value]) => value);
    expect(cached).toEqual([JSON.stringify({ kind: "provider_error" })]);
    expectRefusalWhenKeyed();
  });

  it("saved keyword refresh stores no sample metrics and reports none updated", async () => {
    await expect(
      inRequest(() =>
        KeywordResearchService.refreshSavedKeywordMetrics(
          { projectId: "project_1" },
          customer,
        ),
      ),
    ).resolves.toEqual({ updated: 0 });

    expect(await stores.db.select().from(keywordMetrics)).toEqual([]);
    expectRefusalWhenKeyed();
  });

  // Saving makes no DataForSEO call, so its scope can never flag what the
  // browser saw as sample data: the save must not take metrics at all.
  it("saving keywords stores none of the metrics the browser sends", async () => {
    const sent = saveKeywordsSchema.parse({
      projectId: "project_1",
      keywords: ["heat pump"],
      metrics: [{ keyword: "heat pump", searchVolume: 12_000, cpc: 4.2 }],
    });

    await inRequest(() =>
      KeywordResearchService.saveKeywords({
        ...sent,
        locationCode: 2124,
        languageCode: "en",
      }),
    );

    expect(await stores.db.select().from(keywordMetrics)).toEqual([]);
    expect(
      await stores.db
        .select({ keyword: savedKeywords.keyword })
        .from(savedKeywords),
    ).toContainEqual({ keyword: "heat pump" });
  });
});
