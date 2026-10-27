import { env } from "cloudflare:workers";
import { isHostedAuthMode } from "@/lib/auth-mode";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import { asAppError } from "@/server/lib/errors";
import { fetchLiveDomainRankOverview } from "@/server/features/widget-audit/liveDomainRankOverview";
import {
  createPublicWidgetAuditHandler,
  PUBLIC_WIDGET_AUDIT_TURNSTILE_ACTION,
  PublicWidgetAuditError,
  searchOverviewObservationSchema,
  type SearchOverviewObservation,
} from "@/server/features/widget-audit/publicWidgetAudit";

const LOCATION_CODE_CANADA = 2124;
const LOCATION_LABEL_CANADA = "Canada";
const LANGUAGE_CODE_ENGLISH = "en";
const SEARCH_CACHE_TTL_SECONDS = 12 * 60 * 60;
const PROVIDER_ERROR_CACHE_TTL_SECONDS = 2 * 60;
const RATE_WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_RATE_WINDOW = 5;
const LOCAL_DAILY_CALL_LIMIT = 10;

type WidgetAuditRuntimeEnv = {
  AUTH_MODE?: string;
  BETTER_AUTH_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
  WIDGET_AUDIT_DAILY_CALL_LIMIT?: string;
  KV: {
    get(key: string): Promise<string | null>;
    put(
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ): Promise<void>;
  };
};

type ProviderResult = {
  data: Array<{
    metrics?: {
      organic?: {
        etv?: number | null;
        count?: number | null;
      } | null;
    } | null;
  }>;
};

type RuntimeDependencies = {
  runtimeEnv: WidgetAuditRuntimeEnv;
  now(): Date;
  fetchProvider(input: {
    target: string;
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult>;
  verifyTurnstile(input: {
    secret: string;
    token: string;
    ip: string | null;
  }): Promise<{
    success: boolean;
    action: string | null;
    hostname: string | null;
  }>;
};

type CachedSearchEntry =
  | { kind: "success"; observation: SearchOverviewObservation }
  | { kind: "provider_error" };

function dailyCallLimit(runtimeEnv: WidgetAuditRuntimeEnv) {
  const configured = runtimeEnv.WIDGET_AUDIT_DAILY_CALL_LIMIT?.trim();
  if (!configured) {
    if (isHostedAuthMode(runtimeEnv.AUTH_MODE)) {
      throw new PublicWidgetAuditError(
        503,
        "SERVICE_NOT_CONFIGURED",
        "The public audit service is not enabled.",
      );
    }
    return LOCAL_DAILY_CALL_LIMIT;
  }

  if (!/^\d+$/.test(configured)) {
    throw new PublicWidgetAuditError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "The public audit service is not enabled.",
    );
  }

  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new PublicWidgetAuditError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "The public audit service is not enabled.",
    );
  }
  return parsed;
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function verifyCloudflareTurnstile(input: {
  secret: string;
  token: string;
  ip: string | null;
}) {
  const body = new URLSearchParams({
    secret: input.secret,
    response: input.token,
  });
  if (input.ip) body.set("remoteip", input.ip);

  let response: Response;
  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new PublicWidgetAuditError(
      503,
      "HUMAN_VERIFICATION_UNAVAILABLE",
      "Human verification is temporarily unavailable.",
      60,
    );
  }

  if (!response.ok) {
    throw new PublicWidgetAuditError(
      503,
      "HUMAN_VERIFICATION_UNAVAILABLE",
      "Human verification is temporarily unavailable.",
      60,
    );
  }

  const parsed = await response.json().catch(() => null);
  if (typeof parsed !== "object" || parsed === null) {
    return { success: false, action: null, hostname: null };
  }
  return {
    success: "success" in parsed && parsed.success === true,
    action:
      "action" in parsed && typeof parsed.action === "string"
        ? parsed.action
        : null,
    hostname:
      "hostname" in parsed && typeof parsed.hostname === "string"
        ? parsed.hostname.toLowerCase()
        : null,
  };
}

function hostedTurnstileHostname(runtimeEnv: WidgetAuditRuntimeEnv) {
  const configuredUrl = runtimeEnv.BETTER_AUTH_URL?.trim();
  if (!configuredUrl) return null;
  try {
    const parsed = new URL(configuredUrl);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function parseCachedEntry(raw: string | null): CachedSearchEntry | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "kind" in value &&
      value.kind === "provider_error"
    ) {
      return { kind: "provider_error" };
    }
    if (
      typeof value === "object" &&
      value !== null &&
      "kind" in value &&
      value.kind === "success" &&
      "observation" in value
    ) {
      const observation = searchOverviewObservationSchema.safeParse(
        value.observation,
      );
      return observation.success
        ? { kind: "success", observation: observation.data }
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

function mapProviderResult(
  result: ProviderResult,
  fetchedAt: string,
): SearchOverviewObservation {
  const metrics = result.data[0]?.metrics?.organic;
  const organicTraffic =
    metrics?.etv != null ? Math.max(0, Math.round(metrics.etv)) : null;
  const organicKeywords =
    metrics?.count != null ? Math.max(0, Math.round(metrics.count)) : null;
  const populatedFields = [organicTraffic, organicKeywords].filter(
    (value) => value !== null,
  ).length;

  return {
    status: populatedFields > 0 ? "AVAILABLE" : "NO_DATA",
    organicTraffic,
    organicKeywords,
    fetchedAt,
    dataAsOf: null,
    provider: "dataforseo",
    integration: "domain_rank_overview_live",
    sourceClass: "estimated",
    locationCode: LOCATION_CODE_CANADA,
    locationLabel: LOCATION_LABEL_CANADA,
    languageCode: LANGUAGE_CODE_ENGLISH,
    completeness:
      populatedFields === 2
        ? "complete"
        : populatedFields === 1
          ? "partial"
          : "unknown",
  };
}

function providerFailure(error: unknown) {
  const appError = asAppError(error);
  const status = appError?.code === "RATE_LIMITED" ? 503 : 502;
  return new PublicWidgetAuditError(
    status,
    "PROVIDER_UNAVAILABLE",
    "The public search estimate is temporarily unavailable.",
    status === 503 ? 60 : undefined,
  );
}

export function createWidgetAuditSearchGateway(
  dependencies: RuntimeDependencies,
) {
  return async function getSearchOverview(input: {
    domain: string;
    request: Request;
    turnstileToken?: string;
  }) {
    const hosted = isHostedAuthMode(dependencies.runtimeEnv.AUTH_MODE);
    const configuredDailyLimit = dailyCallLimit(dependencies.runtimeEnv);
    const ip = input.request.headers.get("cf-connecting-ip");

    if (hosted) {
      const secret = dependencies.runtimeEnv.TURNSTILE_SECRET_KEY?.trim();
      const expectedHostname = hostedTurnstileHostname(dependencies.runtimeEnv);
      if (!secret || !expectedHostname) {
        throw new PublicWidgetAuditError(
          503,
          "SERVICE_NOT_CONFIGURED",
          "The public audit service is not enabled.",
        );
      }
      if (!input.turnstileToken) {
        throw new PublicWidgetAuditError(
          403,
          "HUMAN_VERIFICATION_FAILED",
          "Complete human verification and try again.",
        );
      }
      const verification = await dependencies.verifyTurnstile({
        secret,
        token: input.turnstileToken,
        ip,
      });
      if (
        !verification.success ||
        verification.action !== PUBLIC_WIDGET_AUDIT_TURNSTILE_ACTION ||
        verification.hostname !== expectedHostname
      ) {
        throw new PublicWidgetAuditError(
          403,
          "HUMAN_VERIFICATION_FAILED",
          "Complete human verification and try again.",
        );
      }
    }

    const now = dependencies.now();
    const clientKey = await sha256Hex(ip ?? "unknown");
    const rateWindow = Math.floor(
      now.getTime() / (RATE_WINDOW_SECONDS * 1_000),
    );
    const rateKey = `widget-audit:rate:${clientKey}:${rateWindow}`;

    let rateCount: number;
    try {
      const storedRate = Number(await dependencies.runtimeEnv.KV.get(rateKey));
      rateCount = Number.isFinite(storedRate) ? storedRate : 0;
      if (rateCount >= MAX_REQUESTS_PER_RATE_WINDOW) {
        throw new PublicWidgetAuditError(
          429,
          "RATE_LIMITED",
          "Too many audit requests. Try again in a minute.",
          RATE_WINDOW_SECONDS,
        );
      }
      await dependencies.runtimeEnv.KV.put(rateKey, String(rateCount + 1), {
        expirationTtl: RATE_WINDOW_SECONDS * 2,
      });
    } catch (error) {
      if (error instanceof PublicWidgetAuditError) throw error;
      throw new PublicWidgetAuditError(
        503,
        "SERVICE_NOT_CONFIGURED",
        "The public audit service is temporarily unavailable.",
        60,
      );
    }

    const cacheKey = `widget-audit:search:${input.domain}:${LOCATION_CODE_CANADA}:${LANGUAGE_CODE_ENGLISH}`;
    try {
      const cached = parseCachedEntry(
        await dependencies.runtimeEnv.KV.get(cacheKey),
      );
      if (cached?.kind === "success") return cached.observation;
      if (cached?.kind === "provider_error") throw providerFailure(null);
    } catch (error) {
      if (error instanceof PublicWidgetAuditError) throw error;
      throw new PublicWidgetAuditError(
        503,
        "SERVICE_NOT_CONFIGURED",
        "The public audit service is temporarily unavailable.",
        60,
      );
    }

    // This KV counter is an operational guard, not a transactionally strict
    // billing ledger. Hosted execution also requires an explicit configured
    // daily limit so enabling paid public calls is a deliberate deploy choice.
    const budgetKey = `widget-audit:daily:${now.toISOString().slice(0, 10)}`;
    try {
      const storedBudget = Number(
        await dependencies.runtimeEnv.KV.get(budgetKey),
      );
      const used = Number.isFinite(storedBudget) ? storedBudget : 0;
      if (used >= configuredDailyLimit) {
        throw new PublicWidgetAuditError(
          429,
          "DAILY_LIMIT_REACHED",
          "The public audit has reached its daily limit. Try again tomorrow.",
        );
      }
      await dependencies.runtimeEnv.KV.put(budgetKey, String(used + 1), {
        expirationTtl: 2 * 86_400,
      });
    } catch (error) {
      if (error instanceof PublicWidgetAuditError) throw error;
      throw new PublicWidgetAuditError(
        503,
        "SERVICE_NOT_CONFIGURED",
        "The public audit service is temporarily unavailable.",
        60,
      );
    }

    try {
      const result = await dependencies.fetchProvider({
        target: input.domain,
        locationCode: LOCATION_CODE_CANADA,
        languageCode: LANGUAGE_CODE_ENGLISH,
      });
      const observation = mapProviderResult(
        result,
        dependencies.now().toISOString(),
      );
      await dependencies.runtimeEnv.KV.put(
        cacheKey,
        JSON.stringify({ kind: "success", observation }),
        { expirationTtl: SEARCH_CACHE_TTL_SECONDS },
      );
      return observation;
    } catch (error) {
      await dependencies.runtimeEnv.KV.put(
        cacheKey,
        JSON.stringify({ kind: "provider_error" }),
        {
          expirationTtl: PROVIDER_ERROR_CACHE_TTL_SECONDS,
        },
      ).catch(() => undefined);
      throw providerFailure(error);
    }
  };
}

export const productionSearchGateway = createWidgetAuditSearchGateway({
  runtimeEnv: env,
  now: () => new Date(),
  fetchProvider: fetchLiveDomainRankOverview,
  verifyTurnstile: verifyCloudflareTurnstile,
});

export const handlePublicWidgetAuditRequest = createPublicWidgetAuditHandler({
  normalizeDomain: (input) => normalizeDomainInput(input, false),
  getSearchOverview: productionSearchGateway,
  now: () => new Date(),
  onError: (error) => {
    const appError = asAppError(error);
    console.error("widget-audit.request.failed", {
      code: appError?.code ?? "INTERNAL_ERROR",
      name: error instanceof Error ? error.name : "UnknownError",
    });
  },
});
