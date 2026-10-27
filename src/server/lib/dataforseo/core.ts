import {
  AiOptimizationApi,
  AppendixApi,
  BacklinksApi,
  BusinessDataApi,
  DataforseoLabsApi,
  KeywordsDataApi,
  OnPageApi,
  SerpApi,
} from "dataforseo-client";
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  markDataforseoLive,
  parseRequestBody,
  readDataforseoKey,
  sampleDataforseoBody,
  sampleReasonFor,
  setDataforseoSampleReason,
} from "@/server/lib/dataforseo/sample";
import type { ErrorCode } from "@/shared/error-codes";

const API_BASE = "https://api.dataforseo.com";
const MAX_DATAFORSEO_ERROR_PAYLOAD_LENGTH = 1600;
// Safety ceiling on any live call (Lighthouse is the slowest, ~tens of seconds).
const DATAFORSEO_REQUEST_TIMEOUT_MS = 60_000;
// Retry idempotent reads on transient 5xx. Total attempts = retries + 1; the
// shared request-timeout signal still caps overall wall time.
const DATAFORSEO_MAX_RETRIES = 2;
const DATAFORSEO_RETRY_BACKOFF_MS = 250;

/**
 * Translates a DataForSEO HTTP/task failure into a product-specific AppError
 * (e.g. "billing issue"). Returns null when the failure isn't one this
 * classifier recognises, so the caller can fall back to a generic error. See
 * {@link createDataforseoBillingClassifier}.
 */
export type DataforseoErrorClassifier = (
  status: number | undefined,
  details: string,
  path: string,
) => AppError | null;

function formatDataforseoErrorPayload(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();

  return text.length > MAX_DATAFORSEO_ERROR_PAYLOAD_LENGTH
    ? `${text.slice(0, MAX_DATAFORSEO_ERROR_PAYLOAD_LENGTH)}... [truncated]`
    : text;
}

const taskStatusBodySchema = z.object({
  tasks: z.array(z.object({ status_code: z.number().optional() })).optional(),
});

/** Task-level status code of a DataForSEO body (HTTP 200 can still carry a refused task). */
async function firstTaskStatus(
  response: Response,
): Promise<number | undefined> {
  try {
    const body = taskStatusBodySchema.safeParse(await response.clone().json());
    return body.success ? body.data.tasks?.[0]?.status_code : undefined;
  } catch {
    return undefined;
  }
}

function formatDataforseoRequestPath(url: RequestInfo): string {
  const rawUrl = typeof url === "string" ? url : url.url;
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return rawUrl;
  }
}

/**
 * The single authenticated `fetch` used by every DataForSEO SDK call. Throws on
 * non-2xx so the SDK's own `ApiException` path never fires; task-level failures
 * (which return HTTP 200) are handled downstream by {@link assertOk}. An
 * optional classifier maps recognised HTTP failures to product errors.
 */
function createAuthenticatedFetch(
  classify?: DataforseoErrorClassifier,
  maxServerErrorRetries = DATAFORSEO_MAX_RETRIES,
) {
  return async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof url === "string" ? url : url.url;
    // Lunar Optimize: no key, or a refusal for auth, credits or quota, answers
    // with labelled sample data (sample.ts) so every screen keeps working.
    const sample = (
      reason: Parameters<typeof setDataforseoSampleReason>[0],
    ) => {
      setDataforseoSampleReason(reason);
      return new Response(
        JSON.stringify(
          sampleDataforseoBody(rawUrl, parseRequestBody(init?.body)),
        ),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-lunar-sample": reason,
          },
        },
      );
    };
    const apiKey = await readDataforseoKey();
    if (apiKey === null) return sample("no_key");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Basic ${apiKey}`);
    // Resolve the signal once so retries share the overall request timeout
    // rather than restarting a fresh 60s budget on each attempt.
    const signal =
      init?.signal ?? AbortSignal.timeout(DATAFORSEO_REQUEST_TIMEOUT_MS);

    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { ...init, headers, signal });
      if (response.ok) {
        const taskCode = await firstTaskStatus(response);
        const reason = sampleReasonFor(response.status, taskCode);
        if (reason) return sample(reason);
        markDataforseoLive();
        return response;
      }
      const httpReason = sampleReasonFor(response.status);
      if (httpReason) return sample(httpReason);

      // Transient upstream 5xx on an idempotent read -> back off and retry.
      if (response.status >= 500 && attempt < maxServerErrorRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, DATAFORSEO_RETRY_BACKOFF_MS * (attempt + 1)),
        );
        continue;
      }

      const rawText = await response.text();
      const path = formatDataforseoRequestPath(url);
      const classified = classify?.(response.status, rawText, path);
      if (classified) throw classified;

      const code: ErrorCode =
        response.status >= 500
          ? "UPSTREAM_UNAVAILABLE"
          : response.status === 429
            ? "RATE_LIMITED"
            : response.status === 401
              ? "DATAFORSEO_AUTH_FAILED"
              : "INTERNAL_ERROR";
      const error = new AppError(
        code,
        `DataForSEO HTTP ${response.status} on ${path}`,
        {
          provider: "dataforseo",
          providerStatus: String(response.status),
          providerPath: path,
          responseBody: formatDataforseoErrorPayload(rawText),
        },
      );
      error.name = "DataForSEOHttpError";
      throw error;
    }
  };
}

function http(
  classify?: DataforseoErrorClassifier,
  maxServerErrorRetries = DATAFORSEO_MAX_RETRIES,
) {
  return { fetch: createAuthenticatedFetch(classify, maxServerErrorRetries) };
}

// Per-section API factories. Each is created per-request so the auth secret is
// read lazily (it lives in the Worker env, not in module scope).
export const labsApi = () => new DataforseoLabsApi(API_BASE, http());
export const keywordsDataApi = () => new KeywordsDataApi(API_BASE, http());
export const serpApi = () => new SerpApi(API_BASE, http());
export const businessDataApi = () => new BusinessDataApi(API_BASE, http());
// task_post creates a billed task. A 5xx does not prove the provider skipped
// the charge, so this client must not replay it (same rule as Lighthouse).
export const businessDataTaskApi = () =>
  new BusinessDataApi(API_BASE, http(undefined, 0));
// Lighthouse live is a billed, non-idempotent POST. A 5xx does not prove the
// provider skipped the charge, so this client must not replay it.
export const onPageApi = () => new OnPageApi(API_BASE, http(undefined, 0));
// Account/appendix data (spend, balance, rates). userData() is FREE ($0) and
// read-only — do NOT wire it through metering.
export const appendixApi = () => new AppendixApi(API_BASE, http());
export const backlinksApi = (classify?: DataforseoErrorClassifier) =>
  new BacklinksApi(API_BASE, http(classify));
export const aiOptimizationApi = (classify?: DataforseoErrorClassifier) =>
  new AiOptimizationApi(API_BASE, http(classify));
