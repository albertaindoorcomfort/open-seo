import { z } from "zod";

const MAX_REQUEST_BODY_CHARACTERS = 16_384;
export const PUBLIC_WIDGET_AUDIT_TURNSTILE_ACTION = "public_widget_audit";

const requestSchema = z
  .object({
    domain: z.string().trim().min(1).max(300),
    // Optional lead contact only — never used as a billing identity.
    email: z.string().trim().email().max(320).optional(),
    turnstileToken: z.string().max(2_048).optional(),
  })
  .strict();

export const searchOverviewObservationSchema = z.object({
  status: z.enum(["AVAILABLE", "NO_DATA"]),
  organicTraffic: z.number().int().nonnegative().nullable(),
  organicKeywords: z.number().int().nonnegative().nullable(),
  fetchedAt: z.string().datetime(),
  dataAsOf: z.string().datetime().nullable(),
  provider: z.literal("dataforseo"),
  integration: z.literal("domain_rank_overview_live"),
  sourceClass: z.literal("estimated"),
  locationCode: z.number().int().positive(),
  locationLabel: z.string().min(1),
  languageCode: z.string().min(1),
  completeness: z.enum(["complete", "partial", "unknown"]),
});

export type SearchOverviewObservation = z.infer<
  typeof searchOverviewObservationSchema
>;

type PublicWidgetAuditDependencies = {
  normalizeDomain(input: string): string;
  getSearchOverview(input: {
    domain: string;
    request: Request;
    turnstileToken?: string;
  }): Promise<SearchOverviewObservation>;
  now(): Date;
  onError?(error: unknown): void;
};

type PublicErrorCode =
  | "DAILY_LIMIT_REACHED"
  | "HUMAN_VERIFICATION_FAILED"
  | "HUMAN_VERIFICATION_UNAVAILABLE"
  | "METHOD_NOT_ALLOWED"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "REQUEST_TOO_LARGE"
  | "SERVICE_NOT_CONFIGURED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "VALIDATION_ERROR";

export class PublicWidgetAuditError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: PublicErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PublicWidgetAuditError";
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
} as const;

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(CORS_HEADERS);
  responseHeaders.set("Cache-Control", "no-store");
  new Headers(headers).forEach((value, key) => {
    responseHeaders.set(key, value);
  });

  return Response.json(body, {
    status,
    headers: responseHeaders,
  });
}

function parseRequestBody(rawBody: string) {
  if (rawBody.length > MAX_REQUEST_BODY_CHARACTERS) {
    throw new PublicWidgetAuditError(
      413,
      "REQUEST_TOO_LARGE",
      "The request body is too large.",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch {
    throw new PublicWidgetAuditError(
      400,
      "VALIDATION_ERROR",
      "Send a valid JSON request body.",
    );
  }

  const parsed = requestSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new PublicWidgetAuditError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "The request is invalid.",
    );
  }

  return parsed.data;
}

function unavailableLayer(
  status: "NOT_CONNECTED" | "NOT_RUN" | "UNAVAILABLE",
  reason: string,
) {
  return { status, reason };
}

function buildAuditResponse(
  domain: string,
  generatedAt: string,
  search: SearchOverviewObservation,
) {
  return {
    schemaVersion: "2026-08-20",
    auditMode: "public_baseline",
    status: "PARTIAL",
    domain,
    generatedAt,
    summary: {
      reputationRiskScore: {
        status: "NOT_COMPUTED",
        value: null,
        reason:
          "No reconciled reputation evidence was acquired for this audit.",
      },
      overallDataConfidence: {
        status: "NOT_COMPUTED",
        value: null,
        reason:
          "Confidence requires metric-level factors and corroborating evidence.",
      },
    },
    layers: {
      search: {
        ...search,
        reconciliationStatus: "UNRESOLVED",
        confidence: null,
        confidenceReason:
          "A single estimated provider response is not corroborated evidence.",
      },
      website: unavailableLayer(
        "NOT_RUN",
        "The bounded public crawler is not connected to this endpoint yet.",
      ),
      reputation: unavailableLayer(
        "UNAVAILABLE",
        "Google Business Profile, review, and trust-authority evidence were not fetched.",
      ),
      analytics: unavailableLayer(
        "NOT_CONNECTED",
        "GA4 and Search Console require authenticated first-party access.",
      ),
      brand: unavailableLayer(
        "NOT_RUN",
        "Brand DNA analysis was not run for this baseline.",
      ),
      execution: unavailableLayer(
        "NOT_CONNECTED",
        "No task-management workspace is connected to a public audit.",
      ),
    },
    discrepancies: [],
    findings: [],
    report: {
      available: false,
      reason:
        "PDF export requires a persisted canonical audit snapshot, which this endpoint does not create yet.",
    },
  };
}

function responseForError(error: unknown, onError?: (error: unknown) => void) {
  if (error instanceof PublicWidgetAuditError) {
    const headers: HeadersInit = {};
    if (error.retryAfterSeconds !== undefined) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      error.status,
      headers,
    );
  }

  onError?.(error);
  return jsonResponse(
    {
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "The public audit provider is temporarily unavailable.",
      },
    },
    502,
  );
}

export function createPublicWidgetAuditHandler(
  dependencies: PublicWidgetAuditDependencies,
) {
  return async function handlePublicWidgetAuditRequest(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return responseForError(
        new PublicWidgetAuditError(
          405,
          "METHOD_NOT_ALLOWED",
          "Only POST requests are supported.",
        ),
      );
    }

    const contentType = request.headers.get("content-type")?.toLowerCase();
    if (!contentType?.startsWith("application/json")) {
      return responseForError(
        new PublicWidgetAuditError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Content-Type must be application/json.",
        ),
      );
    }

    try {
      const input = parseRequestBody(await request.text());
      let domain: string;
      try {
        domain = dependencies.normalizeDomain(input.domain);
      } catch {
        throw new PublicWidgetAuditError(
          400,
          "VALIDATION_ERROR",
          "Enter a valid registrable domain such as example.com.",
        );
      }

      const search = await dependencies.getSearchOverview({
        domain,
        request,
        turnstileToken: input.turnstileToken,
      });

      return jsonResponse(
        buildAuditResponse(domain, dependencies.now().toISOString(), search),
      );
    } catch (error) {
      return responseForError(error, (caught) =>
        dependencies.onError?.(caught),
      );
    }
  };
}
