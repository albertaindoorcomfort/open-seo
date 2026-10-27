import { z } from "zod";
import { TenantLinkService } from "@/server/features/tenant-link/services/TenantLinkService";
import { captureServerError } from "@/server/lib/posthog";
import { arrivedThroughProxy } from "@/server/lib/loopbackOnly";
import { getEnvValueSync } from "@/server/lib/runtime-env";
import { timingSafeEqual } from "@/server/lib/timingSafeEqual";

// Machine-principal endpoint for the platform (Mission Control) to set and read
// organization-to-tenant links. Callers send
// `Authorization: Bearer <OPTIMIZE_PLATFORM_SECRET>`. An unset or short secret
// means the route answers 404, as if it did not exist.
//
//   GET  ?organizationId=<id> or ?tenantId=<id>  -> { link: <link> | null }
//   POST { action: "link", organizationId, tenantId, actor, replace? }
//   POST { action: "unlink", organizationId, actor, tenantId? }

export const TENANT_LINK_PATH = "/internal/tenant-link";

const MIN_SECRET_LENGTH = 32;
const MAX_BODY_CHARS = 4096;

const idSchema = z.string().trim().min(1).max(200);

const writeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("link"),
      organizationId: idSchema,
      tenantId: idSchema,
      actor: idSchema,
      replace: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("unlink"),
      organizationId: idSchema,
      actor: idSchema,
      // When set, only the link to this tenant is removed (409 otherwise).
      tenantId: idSchema.optional(),
    })
    .strict(),
]);

const LINK_STATUS_CODES = {
  linked: 200,
  unchanged: 200,
  replaced: 200,
  conflict: 409,
  unknown_organization: 422,
} as const;

const UNLINK_STATUS_CODES = {
  unlinked: 200,
  not_linked: 200,
  conflict: 409,
} as const;

async function readLink(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  // Same trimming and length cap as the POST body, so a read finds what a
  // write stored.
  const optionalId = (name: string) => {
    const value = params.get(name);
    if (value === null) return { ok: true as const, id: null };
    const parsed = idSchema.safeParse(value);
    return parsed.success
      ? { ok: true as const, id: parsed.data }
      : { ok: false as const };
  };
  const organization = optionalId("organizationId");
  const tenant = optionalId("tenantId");
  if (!organization.ok || !tenant.ok) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  const organizationId = organization.id;
  const tenantId = tenant.id;
  if (organizationId && !tenantId) {
    const link =
      await TenantLinkService.getTenantForOrganization(organizationId);
    return Response.json({ link });
  }
  if (tenantId && !organizationId) {
    const link = await TenantLinkService.getOrganizationForTenant(tenantId);
    return Response.json({ link });
  }
  return Response.json(
    { error: "pass exactly one of organizationId or tenantId" },
    { status: 400 },
  );
}

async function writeLink(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = writeSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  if (parsed.data.action === "unlink") {
    const result = await TenantLinkService.unlink(parsed.data);
    return Response.json(result, {
      status: UNLINK_STATUS_CODES[result.status],
    });
  }
  const result = await TenantLinkService.link(parsed.data);
  return Response.json(result, { status: LINK_STATUS_CODES[result.status] });
}

export async function handleTenantLinkRequest(
  request: Request,
  env: object,
): Promise<Response> {
  const secret = getEnvValueSync(env, "OPTIMIZE_PLATFORM_SECRET")?.trim();
  if (
    !secret ||
    secret.length < MIN_SECRET_LENGTH ||
    arrivedThroughProxy(request)
  ) {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  }
  if (
    !timingSafeEqual(
      request.headers.get("authorization") ?? "",
      `Bearer ${secret}`,
    )
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    return request.method === "GET"
      ? await readLink(request)
      : await writeLink(request);
  } catch (error) {
    // Raw fetch handlers run outside the server-function middleware, so
    // nothing else reports failures here.
    console.error("[tenant-link] request failed:", error);
    await captureServerError(error, { source: "tenant_link" });
    return Response.json({ error: "tenant link failed" }, { status: 500 });
  }
}
