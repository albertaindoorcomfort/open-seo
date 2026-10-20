import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OPENSEO_APOLLO_TOOLS } from "@/integrations/apollo/catalog";
import { connectOpenSeoForApollo } from "@/integrations/apollo/client";
import { createWorkersOAuthMcpProps } from "@/server/mcp/context";
import { createOpenSeoMcpServer } from "@/server/mcp/server";

vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
  DurableObject: class {
    readonly ctx = null;
  },
}));

async function connected(server: McpServer) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return clientTransport;
}

describe("OpenSEO tools for Apollo", () => {
  it("maps every Apollo tool to a tool the OpenSEO MCP server registers", async () => {
    const server = createOpenSeoMcpServer(
      createWorkersOAuthMcpProps({
        userId: "user_test",
        userEmail: "test@example.com",
        organizationId: "org_test",
        baseUrl: "https://open-seo.test",
        clientId: "client_test",
        scopes: ["mcp"],
      }),
    );
    const client = new Client({ name: "apollo-catalog", version: "1" });
    await client.connect(await connected(server));
    const { tools } = await client.listTools();
    const registered = new Set(tools.map((tool) => tool.name));

    const missing = Object.values(OPENSEO_APOLLO_TOOLS)
      .map((entry) => entry.mcpTool)
      .filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
    await client.close();
  });

  it("calls the mapped tool and reports credits, source and blockers", async () => {
    const server = new McpServer({ name: "fake-openseo", version: "1" });
    server.registerTool(
      "research_keywords",
      { inputSchema: z.object({ seeds: z.array(z.string()) }) },
      ({ seeds }) => ({
        content: [{ type: "text", text: `researched ${seeds.join(",")}` }],
        structuredContent: {
          results: [],
          meta: { url: "https://seo.test/p/1/keywords", creditsCharged: 42 },
        },
      }),
    );
    server.registerTool("get_search_console_performance", {}, () => ({
      content: [{ type: "text", text: "not connected" }],
      structuredContent: { ok: false, reason: "gsc_not_connected" },
    }));
    server.registerTool("get_google_analytics_organic_overview", {}, () => ({
      content: [{ type: "text", text: "not connected" }],
      structuredContent: {
        status: "error",
        error: { code: "ga4_not_connected" },
      },
    }));
    server.registerTool("run_site_audit", {}, () => ({
      content: [{ type: "text", text: "audit capacity reached" }],
      isError: true,
    }));
    const openSeo = await connectOpenSeoForApollo(await connected(server));

    await expect(
      openSeo.call("seo.keyword_research", { seeds: ["furnace repair"] }),
    ).resolves.toMatchObject({
      mcpTool: "research_keywords",
      text: "researched furnace repair",
      creditsCharged: 42,
      evidence: [{ sourceRef: "https://seo.test/p/1/keywords" }],
    });
    await expect(openSeo.call("seo.gsc_performance", {})).rejects.toMatchObject(
      { code: "NOT_CONNECTED", message: "gsc_not_connected" },
    );
    await expect(
      openSeo.call("seo.ga4_organic_overview", {}),
    ).rejects.toMatchObject({
      code: "NOT_CONNECTED",
      message: "ga4_not_connected",
    });
    await expect(openSeo.call("seo.audit_start", {})).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: "audit capacity reached",
    });
    await expect(openSeo.call("seo.delete_audit", {})).rejects.toMatchObject({
      code: "UNKNOWN_TOOL",
    });
    await openSeo.close();
  });
});
