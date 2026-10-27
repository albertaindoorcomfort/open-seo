import { createFileRoute } from "@tanstack/react-router";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import {
  buildAuditResponse,
  PublicWidgetAuditError,
} from "@/server/features/widget-audit/publicWidgetAudit";
import { productionSearchGateway } from "@/server/features/widget-audit/publicWidgetAuditRuntime";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
} as const;

function jsonResponse(body: unknown, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers(CORS_HEADERS);
  new Headers(extra).forEach((v, k) => headers.set(k, v));
  return Response.json(body, { status, headers });
}

async function handleDomainScanRequest(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const rawDomain = url.searchParams.get("domain")?.trim();

  if (!rawDomain) {
    return jsonResponse(
      { error: { code: "VALIDATION_ERROR", message: "domain query parameter is required." } },
      400,
    );
  }

  let domain: string;
  try {
    domain = normalizeDomainInput(rawDomain, false);
  } catch {
    return jsonResponse(
      { error: { code: "VALIDATION_ERROR", message: "Enter a valid registrable domain such as example.com." } },
      400,
    );
  }

  try {
    const search = await productionSearchGateway({ domain, request });
    return jsonResponse(buildAuditResponse(domain, new Date().toISOString(), search));
  } catch (error) {
    if (error instanceof PublicWidgetAuditError) {
      const extra: HeadersInit = {};
      if (error.retryAfterSeconds !== undefined) {
        extra["Retry-After"] = String(error.retryAfterSeconds);
      }
      return jsonResponse(
        { error: { code: error.code, message: error.message } },
        error.status,
        extra,
      );
    }
    return jsonResponse(
      { error: { code: "PROVIDER_UNAVAILABLE", message: "The scan provider is temporarily unavailable." } },
      502,
    );
  }
}

export const Route = createFileRoute("/api/widget/domain-scan")({
  server: {
    handlers: {
      GET: ({ request }) => handleDomainScanRequest(request),
      OPTIONS: ({ request }) => handleDomainScanRequest(request),
    },
  },
});
