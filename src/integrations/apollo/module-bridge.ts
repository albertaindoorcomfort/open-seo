import { z } from "zod";
import type { Transport } from "@modelcontextprotocol/client";
import {
  connectOpenSeoForApollo,
  OpenSeoToolError,
} from "@/integrations/apollo/client";

// The OpenSEO side of Apollo's signed module protocol. Apollo's gate has
// already authorized the call, reserved budget and, for the tools that spend
// credits, collected a human approval. This handler checks that the request
// really came from Apollo (HMAC over `${timestamp}.${rawBody}`, 5 minute
// window), finds the OpenSEO project and API key linked to the tenant, and
// runs the call through OpenSEO's own MCP endpoint, so the existing API key
// auth, project authz, credit billing and rate limits all still apply.

export const AIC_TOOLS_PREFIX = "/aic/tools/";
const MAX_SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 64 * 1024;

const callSchema = z.object({
  tenantId: z.string().min(1),
  agentId: z.string().min(1),
  userId: z.string().min(1),
  taskId: z.string().nullable(),
  sessionId: z.string().nullable(),
  approvalId: z.string().nullable(),
  args: z.record(z.string(), z.unknown()),
});

type ModuleCall = z.infer<typeof callSchema>;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Apollo's tool names and argument shapes, mapped onto the adapter catalog.
// Apollo validates arguments before it signs; these schemas re-check them
// here because this endpoint must not trust its own network.
const BRIDGED_TOOLS = {
  "openseo.site_audit": {
    tool: "seo.audit_start",
    spendsCredits: true,
    args: z.object({
      url: z.url(),
      maxPages: z.number().int().min(10).max(200),
    }),
    toMcp: (a: { url: string; maxPages: number }) => ({
      url: a.url,
      maxPages: a.maxPages,
    }),
  },
  "openseo.keyword_research": {
    tool: "seo.keyword_research",
    spendsCredits: true,
    args: z.object({
      seeds: z.array(z.string().min(2).max(80)).min(1).max(5),
      locationCode: z.number().int().positive().optional(),
    }),
    toMcp: (a: { seeds: string[]; locationCode?: number }) => ({
      seeds: a.seeds.map((seed) => ({ seed, locationCode: a.locationCode })),
    }),
  },
  "openseo.search_performance": {
    tool: "seo.gsc_performance",
    spendsCredits: false,
    args: z.object({
      from: dateSchema,
      to: dateSchema,
      dimension: z.enum(["query", "page", "country", "device"]),
    }),
    toMcp: (a: { from: string; to: string; dimension: string }) => ({
      startDate: a.from,
      endDate: a.to,
      dimensions: [a.dimension],
    }),
  },
} as const;

type BridgedToolName = keyof typeof BRIDGED_TOOLS;

function isBridgedTool(name: string): name is BridgedToolName {
  return Object.hasOwn(BRIDGED_TOOLS, name);
}

const tenantLinksSchema = z.record(
  z.string().min(1),
  z.object({
    projectId: z.string().min(1),
    // Required on hosted OpenSEO. A trusted self-hosted instance in
    // AUTH_MODE=local_noauth serves /mcp without one.
    apiKey: z.string().startsWith("oseo_").optional(),
  }),
);

type TenantLinks = z.infer<typeof tenantLinksSchema>;

/**
 * Reads AIC_TENANT_LINKS: JSON mapping each Apollo tenant id to its OpenSEO
 * project and API key. A malformed value links no tenant, so every call is
 * refused rather than half-configured.
 */
export function parseTenantLinks(raw: string | undefined): TenantLinks {
  if (!raw) return {};
  try {
    return tenantLinksSchema.parse(JSON.parse(raw));
  } catch {
    console.error(
      "[aic-bridge] AIC_TENANT_LINKS is not valid; no tenant is linked",
    );
    return {};
  }
}

type BridgeOptions = {
  secret: string;
  tenants: TenantLinks;
  /** Opens a transport to OpenSEO's own /mcp route with the tenant's key. */
  transport: (apiKey: string | undefined) => Transport | Promise<Transport>;
  now?: () => Date;
};

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

function fail(status: number, error: string, details: string[] = []) {
  return reply(status, { error, details });
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(
  request: Request,
  rawBody: string,
  opts: BridgeOptions,
) {
  const ts = Number(request.headers.get("x-aic-timestamp"));
  const signature = request.headers.get("x-aic-signature") ?? "";
  if (!Number.isInteger(ts)) return false;
  const nowSeconds = Math.floor((opts.now?.() ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;
  const expected = `v1=${await hmacHex(opts.secret, `${ts}.${rawBody}`)}`;
  return sameText(signature, expected);
}

async function runCall(
  name: BridgedToolName,
  call: ModuleCall,
  opts: BridgeOptions,
) {
  const bridged = BRIDGED_TOOLS[name];
  const link = opts.tenants[call.tenantId];
  if (!link) return fail(403, "TENANT_NOT_LINKED");
  if (bridged.spendsCredits && !call.approvalId)
    return fail(403, "APPROVAL_REQUIRED");
  const args = bridged.args.safeParse(call.args);
  if (!args.success) {
    return fail(
      422,
      "INVALID_ARGS",
      args.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each entry's toMcp takes that entry's parsed args; TS cannot correlate the union
  const mcpArgs = (bridged.toMcp as (a: unknown) => Record<string, unknown>)(
    args.data,
  );

  let client;
  try {
    client = await connectOpenSeoForApollo(await opts.transport(link.apiKey));
  } catch {
    return fail(502, "OPENSEO_UNREACHABLE");
  }
  try {
    const outcome = await client.call(bridged.tool, {
      ...mcpArgs,
      projectId: link.projectId,
    });
    return reply(200, {
      result: {
        ...outcome.result,
        creditsCharged: outcome.creditsCharged,
        sourceUrl: outcome.evidence[0]?.sourceRef ?? null,
      },
    });
  } catch (error) {
    if (error instanceof OpenSeoToolError) {
      return fail(422, `OPENSEO_${error.code}`, [error.message.slice(0, 200)]);
    }
    return fail(502, "OPENSEO_UNREACHABLE");
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Handles POST /aic/tools/<name> from Apollo. */
export async function handleAicToolRequest(
  request: Request,
  opts: BridgeOptions,
): Promise<Response> {
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (opts.secret.length < 32) return fail(503, "MODULE_NOT_CONFIGURED");
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return fail(413, "BODY_TOO_LARGE");
  // Nothing about the call is read before the signature checks out.
  if (!(await verifySignature(request, rawBody, opts)))
    return fail(401, "BAD_SIGNATURE");

  const name = decodeURIComponent(
    new URL(request.url).pathname.slice(AIC_TOOLS_PREFIX.length),
  );
  if (!isBridgedTool(name)) return fail(404, "UNKNOWN_TOOL");
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, "INVALID_BODY");
  }
  const call = callSchema.safeParse(body);
  if (!call.success) return fail(400, "INVALID_BODY");
  return runCall(name, call.data, opts);
}
