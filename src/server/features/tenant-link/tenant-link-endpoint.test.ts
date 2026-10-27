import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as EndpointModule from "./tenant-link-endpoint";
import type * as RepositoryModule from "./repositories/TenantLinkRepository";

// Real in-memory SQLite built from the real migration, so the primary key, the
// unique tenant index and the organization foreign key all run as shipped.

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

const SECRET = "p".repeat(40);
const ENV = { OPTIMIZE_PLATFORM_SECRET: SECRET };

let client: Client;
let log: ReturnType<typeof vi.spyOn>;
let handleTenantLinkRequest: typeof EndpointModule.handleTenantLinkRequest;
let TenantLinkRepository: typeof RepositoryModule.TenantLinkRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const testDb = drizzle(client);
  // testDb only exists at runtime, so the module under test must load after
  // this mock: the sanctioned doMock + dynamic import.
  vi.doMock("@/db", () => ({ db: testDb }));
  await client.executeMultiple(
    [
      "PRAGMA foreign_keys = ON;",
      "CREATE TABLE organization (id TEXT PRIMARY KEY);",
      ...readFileSync(
        "drizzle/0043_organization_tenant_link.sql",
        "utf8",
      ).split("--> statement-breakpoint"),
    ].join("\n"),
  );
  ({ handleTenantLinkRequest } = await import("./tenant-link-endpoint"));
  ({ TenantLinkRepository } =
    await import("./repositories/TenantLinkRepository"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  // The shell may carry a real value; the env passed in is the only source.
  delete process.env.OPTIMIZE_PLATFORM_SECRET;
  log = vi.spyOn(console, "warn").mockImplementation(() => {});
  await client.executeMultiple(`
    DELETE FROM organization_tenant_link;
    DELETE FROM organization;
    INSERT INTO organization (id) VALUES ('org_a'), ('org_b');
  `);
});

function call(
  method: string,
  options: {
    query?: string;
    body?: unknown;
    token?: string;
    env?: object;
    headers?: Record<string, string>;
  },
) {
  const headers = new Headers({
    "content-type": "application/json",
    ...options.headers,
  });
  if (options.token !== "") {
    headers.set("authorization", `Bearer ${options.token ?? SECRET}`);
  }
  const request = new Request(
    `https://optimize.example/internal/tenant-link${options.query ?? ""}`,
    {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  return handleTenantLinkRequest(request, options.env ?? ENV);
}

function link(
  organizationId: string,
  tenantId: string,
  extra: { actor?: string; replace?: boolean } = {},
) {
  return call("POST", {
    body: {
      action: "link",
      organizationId,
      tenantId,
      actor: "mc:operator",
      ...extra,
    },
  });
}

async function readLink(query: string) {
  const response = await call("GET", { query });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  return body;
}

async function linkRowCount() {
  const result = await client.execute(
    "SELECT count(*) AS n FROM organization_tenant_link",
  );
  return Number(result.rows[0]?.n);
}

describe("tenant link endpoint", () => {
  it("links an organization and reads it back both ways, logging the change once", async () => {
    const response = await link("org_a", "tenant_1");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "linked",
      link: { organizationId: "org_a", tenantId: "tenant_1" },
    });
    expect(await readLink("?organizationId=org_a")).toMatchObject({
      link: { tenantId: "tenant_1", linkedBy: "mc:operator" },
    });
    expect(await readLink("?tenantId=tenant_1")).toMatchObject({
      link: { organizationId: "org_a" },
    });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "tenant_link.linked",
      organizationId: "org_a",
      tenantId: "tenant_1",
      actor: "mc:operator",
    });
    expect(line).not.toContain(SECRET);
  });

  it("treats relinking the same pair as a no-op", async () => {
    const first: { link: { linkedAt: string } } = await (
      await link("org_a", "tenant_1")
    ).json();
    const again = await link("org_a", "tenant_1", { actor: "mc:someone-else" });

    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      status: "unchanged",
      link: { linkedBy: "mc:operator", linkedAt: first.link.linkedAt },
    });
    // Only the first link wrote a log line.
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("refuses to re-point a linked organization unless replace is set", async () => {
    await link("org_a", "tenant_1");

    const refused = await link("org_a", "tenant_2");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      status: "conflict",
      reason: "organization_linked_to_other_tenant",
      link: { tenantId: "tenant_1" },
    });
    expect(await readLink("?organizationId=org_a")).toMatchObject({
      link: { tenantId: "tenant_1" },
    });

    const replaced = await link("org_a", "tenant_2", { replace: true });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ status: "replaced" });
    expect(await readLink("?tenantId=tenant_1")).toEqual({ link: null });
    expect(await readLink("?tenantId=tenant_2")).toMatchObject({
      link: { organizationId: "org_a" },
    });
  });

  it("keeps a tenant on one organization, even with replace", async () => {
    await link("org_a", "tenant_1");

    const refused = await link("org_b", "tenant_1", { replace: true });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      reason: "tenant_linked_to_other_organization",
      link: { organizationId: "org_a" },
    });
    expect(await linkRowCount()).toBe(1);
  });

  it("refuses an organization that does not exist", async () => {
    const response = await link("org_missing", "tenant_1");

    expect(response.status).toBe(422);
    expect(await linkRowCount()).toBe(0);
  });

  it("unlinks, and a second unlink is a no-op", async () => {
    await link("org_a", "tenant_1");
    const unlink = () =>
      call("POST", {
        body: { action: "unlink", organizationId: "org_a", actor: "mc:op" },
      });

    expect(await (await unlink()).json()).toMatchObject({
      status: "unlinked",
      link: { tenantId: "tenant_1" },
    });
    expect(await readLink("?organizationId=org_a")).toEqual({ link: null });
    expect(await (await unlink()).json()).toEqual({ status: "not_linked" });
  });

  it("does not exist without a secret of at least 32 characters", async () => {
    expect((await call("GET", { query: "?tenantId=t", env: {} })).status).toBe(
      404,
    );
    const short = "s".repeat(31);
    const response = await call("GET", {
      query: "?tenantId=t",
      token: short,
      env: { OPTIMIZE_PLATFORM_SECRET: short },
    });
    expect(response.status).toBe(404);
  });

  it("refuses a wrong or missing bearer token before touching links", async () => {
    const body = {
      action: "link",
      organizationId: "org_a",
      tenantId: "tenant_1",
      actor: "mc:operator",
    };

    expect((await call("POST", { body, token: "x".repeat(40) })).status).toBe(
      401,
    );
    expect((await call("POST", { body, token: "" })).status).toBe(401);
    expect(await linkRowCount()).toBe(0);
  });
  it("only unlinks the named tenant when one is given", async () => {
    await link("org_a", "tenant_1");
    const unlink = (tenantId: string) =>
      call("POST", {
        body: {
          action: "unlink",
          organizationId: "org_a",
          actor: "mc:op",
          tenantId,
        },
      });

    const stale = await unlink("tenant_0");
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      status: "conflict",
      link: { tenantId: "tenant_1" },
    });
    expect(await linkRowCount()).toBe(1);
    expect((await unlink("tenant_1")).status).toBe(200);
    expect(await linkRowCount()).toBe(0);
  });

  it("does not overwrite a link that moved after the replace read it", async () => {
    await link("org_a", "tenant_1");
    // Another writer moves the link to tenant_3 between this replace's read
    // and its update.
    const stale = {
      ...(await TenantLinkRepository.getByOrganizationId("org_a"))!,
    };
    await client.execute(
      "UPDATE organization_tenant_link SET tenant_id = 'tenant_3' WHERE organization_id = 'org_a'",
    );
    vi.spyOn(TenantLinkRepository, "getByOrganizationId").mockResolvedValueOnce(
      stale,
    );

    const response = await link("org_a", "tenant_2", { replace: true });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      reason: "organization_linked_to_other_tenant",
      link: { tenantId: "tenant_3" },
    });
    expect(await readLink("?organizationId=org_a")).toMatchObject({
      link: { tenantId: "tenant_3" },
    });
  });

  it("reads ids the way writes store them", async () => {
    await link(" org_a ", "tenant_1");

    expect(await readLink("?organizationId=%20org_a%20")).toMatchObject({
      link: { tenantId: "tenant_1" },
    });
    const tooLong = await call("GET", {
      query: `?tenantId=${"t".repeat(201)}`,
    });
    expect(tooLong.status).toBe(400);
  });

  it("does not exist for requests that came through the public proxy", async () => {
    for (const header of ["x-forwarded-for", "x-real-ip"]) {
      const response = await call("GET", {
        query: "?tenantId=tenant_1",
        headers: { [header]: "203.0.113.9" },
      });
      expect(response.status).toBe(404);
    }
  });
});
