import { AppError } from "@/server/lib/errors";
import {
  assertPublicUrl,
  publicUrlOrNull,
  type ResolveHost,
} from "@/server/lib/ssrf-guard";

/**
 * Synchronous pre-filter for URLs discovered mid-crawl (links, redirect
 * targets, sitemap entries) before they enter the frontier: scheme, port and
 * host shape (src/server/lib/ssrf-guard.ts). The DNS check runs again when a
 * queued URL is fetched (crawlPage uses guardedFetch).
 */
export function isCrawlableUrl(url: string): boolean {
  return publicUrlOrNull(url) !== null;
}

export async function normalizeAndValidateStartUrl(
  input: string,
  resolve?: ResolveHost,
): Promise<string> {
  let raw = input.trim();
  if (!raw) throw new AppError("VALIDATION_ERROR");

  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    raw = `https://${raw}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError("VALIDATION_ERROR");
  }

  // Public hosts only: private, loopback and metadata addresses are refused,
  // and the host's DNS answers are checked before anything is fetched.
  parsed = await assertPublicUrl(parsed.toString(), resolve);

  parsed.hash = "";
  return parsed.toString();
}

const START_URL_REDIRECT_HOPS = 5;
const START_URL_PROBE_TIMEOUT_MS = 10_000;

/**
 * Follow redirects on the audit's start URL so the audit anchors to the
 * site's real origin. Without this, auditing a domain that 301s elsewhere
 * (…net -> …com, apex -> www) dead-ends after one page: the redirect target
 * is a different origin, so the same-origin crawl policy can't follow it.
 *
 * Every hop re-runs the full start-URL validation (SSRF, blocked hosts), so
 * a redirect can't smuggle the audit somewhere the user couldn't have
 * pointed it directly. Probe failures (timeouts, HEAD rejected) fall back
 * to the last validated URL — the crawl records the real fetch result.
 */
export async function resolveStartUrlRedirects(
  startUrl: string,
): Promise<string> {
  let current = startUrl;
  for (let hop = 0; hop < START_URL_REDIRECT_HOPS; hop++) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        headers: { "User-Agent": "OpenSEO-Audit/1.0" },
        signal: AbortSignal.timeout(START_URL_PROBE_TIMEOUT_MS),
      });
    } catch {
      return current;
    }
    if (response.status < 300 || response.status >= 400) return current;
    const location = response.headers.get("location");
    if (!location) return current;

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return current;
    }
    current = await normalizeAndValidateStartUrl(next.toString());
  }
  return current;
}
