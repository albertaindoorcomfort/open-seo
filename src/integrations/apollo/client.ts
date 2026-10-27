import {
  type CallToolResult,
  Client,
  isCallToolResult,
  StreamableHTTPClientTransport,
  type Transport,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import {
  isOpenSeoApolloTool,
  OPENSEO_APOLLO_TOOLS,
} from "@/integrations/apollo/catalog";
import { BRAND } from "@/shared/brand";

// The Apollo side of an OpenSEO call. Apollo authorizes the call, reserves
// budget and writes the audit event; this client only reaches OpenSEO over its
// MCP endpoint with a user-scoped API key and normalizes the answer. Tool
// output is external data: Apollo must pass `text` to models inside its
// untrusted envelope.

type OpenSeoEvidence = {
  kind: "observation";
  claim: string;
  sourceRef: string | null;
};

type OpenSeoToolOutcome = {
  tool: string;
  mcpTool: string;
  result: Record<string, unknown>;
  text: string;
  creditsCharged: number;
  evidence: OpenSeoEvidence[];
};

export class OpenSeoToolError extends Error {
  constructor(
    readonly code:
      | "UNKNOWN_TOOL"
      | "TOOL_ERROR"
      | "NOT_CONNECTED"
      | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
  }
}

const metaSchema = z.looseObject({
  url: z.string().optional(),
  creditsCharged: z.number().optional(),
});

const MAX_TEXT_CHARS = 20_000;

function resultText(result: CallToolResult) {
  return result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
}

// Google-backed tools refuse in-band when a property is not connected: Search
// Console answers ok:false with a reason, GA4 answers status:"error" with a
// code. Apollo must report either as a blocker, not as data.
const refusalSchema = z.union([
  z
    .looseObject({ ok: z.literal(false), reason: z.string() })
    .transform((r) => r.reason),
  z
    .looseObject({
      status: z.literal("error"),
      error: z.looseObject({ code: z.string() }),
    })
    .transform((r) => r.error.code),
]);

function normalizeToolResult(
  tool: string,
  mcpTool: string,
  result: CallToolResult,
): OpenSeoToolOutcome {
  const text = resultText(result);
  if (result.isError) {
    throw new OpenSeoToolError("TOOL_ERROR", text || `${mcpTool} failed`);
  }
  const structured = z
    .record(z.string(), z.unknown())
    .catch({})
    .parse(result.structuredContent);
  const refusal = refusalSchema.safeParse(structured);
  if (refusal.success) {
    throw new OpenSeoToolError("NOT_CONNECTED", refusal.data);
  }
  const meta = metaSchema.safeParse(structured.meta ?? result._meta ?? {});
  const sourceRef = meta.success ? (meta.data.url ?? null) : null;
  return {
    tool,
    mcpTool,
    result: structured,
    text,
    creditsCharged: meta.success ? (meta.data.creditsCharged ?? 0) : 0,
    evidence: [
      {
        kind: "observation",
        claim: `${BRAND.name} ${mcpTool} returned data`,
        sourceRef: sourceRef ?? `openseo:${mcpTool}`,
      },
    ],
  };
}

type OpenSeoApolloClientOptions = {
  /** OpenSEO origin, for example https://seo.example.com. */
  baseUrl: string;
  /**
   * A user-scoped OpenSEO API key (oseo_ prefix). Omit it only for a trusted
   * local instance in AUTH_MODE=local_noauth.
   */
  apiKey?: string;
  fetch?: typeof fetch;
};

export function createOpenSeoTransport({
  baseUrl,
  apiKey,
  fetch: fetchImpl,
}: OpenSeoApolloClientOptions): Transport {
  return new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), {
    requestInit: apiKey ? { headers: { "x-api-key": apiKey } } : undefined,
    fetch: fetchImpl,
  });
}

/**
 * Connects once and runs Apollo-named OpenSEO tools. Pass a transport in tests;
 * production callers use createOpenSeoTransport.
 */
export async function connectOpenSeoForApollo(transport: Transport) {
  const client = new Client({ name: "aic-apollo", version: "1" });
  await client.connect(transport);

  return {
    async call(
      tool: string,
      args: Record<string, unknown>,
    ): Promise<OpenSeoToolOutcome> {
      if (!isOpenSeoApolloTool(tool)) {
        throw new OpenSeoToolError("UNKNOWN_TOOL", `Unknown tool ${tool}`);
      }
      const { mcpTool } = OPENSEO_APOLLO_TOOLS[tool];
      const result = await client.callTool({ name: mcpTool, arguments: args });
      if (!isCallToolResult(result)) {
        throw new OpenSeoToolError(
          "INVALID_RESPONSE",
          `${mcpTool} returned no content`,
        );
      }
      return normalizeToolResult(tool, mcpTool, result);
    },
    close: () => client.close(),
  };
}
