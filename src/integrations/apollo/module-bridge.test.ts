import { createHmac } from "node:crypto";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handleAicToolRequest } from "@/integrations/apollo/module-bridge";

const SECRET = "s".repeat(32);
const NOW = new Date("2026-10-22T14:00:00Z");
const TS = Math.floor(NOW.getTime() / 1000);

function fakeOpenSeo(seen: { tool: string; args: unknown; apiKey?: string }[]) {
  return async (apiKey: string | undefined) => {
    const server = new McpServer({ name: "fake-openseo", version: "1" });
    const record =
      (tool: string, structuredContent: Record<string, unknown>) =>
      (args: unknown) => {
        seen.push({ tool, args, apiKey });
        return {
          content: [{ type: "text" as const, text: tool }],
          structuredContent,
        };
      };
    const loose = { inputSchema: z.looseObject({}) };
    server.registerTool(
      "get_search_console_performance",
      loose,
      record("get_search_console_performance", {
        ok: true,
        rows: [{ keys: ["furnace repair"], clicks: 3 }],
        meta: { url: "https://seo.test/p/proj_1/gsc" },
      }),
    );
    server.registerTool(
      "research_keywords",
      loose,
      record("research_keywords", { ok: false, reason: "no_credits" }),
    );
    const [client, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    return client;
  };
}

function signed(
  tool: string,
  call: Record<string, unknown>,
  opts: { ts?: number; secret?: string } = {},
) {
  const body = JSON.stringify({
    tenantId: "ten_aic",
    agentId: "seo_geo",
    userId: "usr_1",
    taskId: "tsk_1",
    sessionId: null,
    approvalId: null,
    ...call,
  });
  const ts = opts.ts ?? TS;
  const signature = `v1=${createHmac("sha256", opts.secret ?? SECRET)
    .update(`${ts}.${body}`)
    .digest("hex")}`;
  return new Request(`https://seo.test/aic/tools/${tool}`, {
    method: "POST",
    headers: { "x-aic-timestamp": String(ts), "x-aic-signature": signature },
    body,
  });
}

function bridge(seen: { tool: string; args: unknown; apiKey?: string }[]) {
  return (request: Request) =>
    handleAicToolRequest(request, {
      secret: SECRET,
      tenants: { ten_aic: { projectId: "proj_1", apiKey: "oseo_test" } },
      transport: fakeOpenSeo(seen),
      now: () => NOW,
    });
}

describe("Apollo module bridge", () => {
  it("runs a signed call in the tenant's linked project with its key", async () => {
    const seen: { tool: string; args: unknown; apiKey?: string }[] = [];
    const res = await bridge(seen)(
      signed("openseo.search_performance", {
        args: { from: "2026-09-01", to: "2026-09-30", dimension: "page" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      result: {
        rows: [{ clicks: 3 }],
        sourceUrl: "https://seo.test/p/proj_1/gsc",
      },
    });
    expect(seen).toEqual([
      {
        tool: "get_search_console_performance",
        apiKey: "oseo_test",
        args: {
          projectId: "proj_1",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          dimensions: ["page"],
        },
      },
    ]);
  });

  it("refuses unsigned, stale, unlinked and unapproved calls before reaching OpenSEO", async () => {
    const seen: { tool: string; args: unknown; apiKey?: string }[] = [];
    const run = bridge(seen);
    const perf = {
      args: { from: "2026-09-01", to: "2026-09-30", dimension: "query" },
    };
    const cases: [Request, number, string][] = [
      [
        signed("openseo.search_performance", perf, { secret: "x".repeat(32) }),
        401,
        "BAD_SIGNATURE",
      ],
      [
        signed("openseo.search_performance", perf, { ts: TS - 301 }),
        401,
        "BAD_SIGNATURE",
      ],
      [
        signed("openseo.search_performance", {
          ...perf,
          tenantId: "ten_other",
        }),
        403,
        "TENANT_NOT_LINKED",
      ],
      [
        signed("openseo.keyword_research", {
          args: { seeds: ["furnace repair"] },
        }),
        403,
        "APPROVAL_REQUIRED",
      ],
      [signed("openseo.delete_audit", perf), 404, "UNKNOWN_TOOL"],
    ];
    for (const [request, status, error] of cases) {
      const res = await run(request);
      const body = z.object({ error: z.string() }).parse(await res.json());
      expect([res.status, body.error]).toEqual([status, error]);
    }
    expect(seen).toEqual([]);
  });

  it("reports an OpenSEO refusal as a final error, not as data", async () => {
    const seen: { tool: string; args: unknown; apiKey?: string }[] = [];
    const res = await bridge(seen)(
      signed("openseo.keyword_research", {
        approvalId: "apr_1",
        args: { seeds: ["furnace repair"], locationCode: 2124 },
      }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "OPENSEO_NOT_CONNECTED",
      details: ["no_credits"],
    });
    expect(seen[0]?.args).toEqual({
      projectId: "proj_1",
      seeds: [{ seed: "furnace repair", locationCode: 2124 }],
    });
  });
});
