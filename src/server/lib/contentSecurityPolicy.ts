import { frameAncestorsPolicy } from "@/server/lib/frameAncestors";
import { getEnvValueSync } from "@/server/lib/runtime-env";

// Turnstile (TurnstileWidget.tsx) loads its script from this origin and renders
// the challenge in an iframe from it.
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

type PolicyOptions = {
  nonce: string;
  // The whole frame-ancestors directive, from frameAncestorsPolicy.
  frameAncestors: string;
  // TURNSTILE_SITE_KEY is set, so sign-up renders the Turnstile challenge.
  turnstile?: boolean;
  // POSTHOG_HOST, baked into the client at build time; unset means no PostHog.
  posthogHost?: string;
  // vite dev only: the TanStack devtools event bus listens on its own port.
  devServer?: boolean;
};

/**
 * The policy for app documents. Scripts run only from this origin, Turnstile
 * and PostHog when configured, or inline with this response's nonce: TanStack
 * Start puts the nonce on its hydration and streaming scripts (router.tsx) and
 * __root.tsx on the theme script. No 'unsafe-eval': zod runs jitless
 * (src/lib/zod-jitless.ts). Styles allow 'unsafe-inline' because the toast
 * library injects a <style> element with no nonce; a style cannot run code.
 * form-action stays 'self': every off-site step (OAuth consent, Google
 * sign-in, checkout) leaves by fetch and a navigation, not a form post.
 */
export function contentSecurityPolicy({
  nonce,
  frameAncestors,
  turnstile = false,
  posthogHost,
  devServer = false,
}: PolicyOptions): string {
  const challenge = turnstile ? [TURNSTILE_ORIGIN] : [];
  const posthog = posthogSources(posthogHost);
  const devtools = devServer ? ["ws://localhost:*"] : [];
  return [
    "default-src 'self'",
    ["script-src 'self'", `'nonce-${nonce}'`, ...challenge, ...posthog].join(
      " ",
    ),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    ["connect-src 'self'", ...posthog, ...devtools].join(" "),
    ["frame-src 'self'", ...challenge].join(" "),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestors,
  ].join("; ");
}

// PostHog Cloud serves its API, flags and lazy-loaded extensions from several
// *.posthog.com hosts; a self-hosted or proxied PostHog uses only its own.
function posthogSources(host: string | undefined): string[] {
  if (!host) return [];
  try {
    const url = new URL(host);
    if (url.protocol !== "https:") return [];
    return url.hostname.endsWith(".posthog.com")
      ? ["https://*.posthog.com"]
      : [url.origin];
  } catch {
    return [];
  }
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

type NonceAwareHandler = (
  request: Request,
  opts: { context: { nonce: string } },
) => Response | Promise<Response>;

/**
 * Wraps the TanStack Start handler: each request gets a fresh nonce, passed in
 * as request context for the router to stamp on its inline scripts, and every
 * HTML response gets the matching policy. A response that already carries a
 * policy keeps its own (two policies intersect, so adding one could only
 * confuse things). OPEN_SEO_FRAME_ANCESTORS lists extra https origins that may
 * frame the app (frameAncestors.ts).
 */
export function withContentSecurityPolicy(handler: NonceAwareHandler) {
  const frameAncestors = frameAncestorsPolicy(
    getEnvValueSync({}, "OPEN_SEO_FRAME_ANCESTORS"),
  );
  const turnstile = Boolean(import.meta.env.TURNSTILE_SITE_KEY?.trim());
  const posthogHost = import.meta.env.POSTHOG_HOST?.trim();
  const devServer = import.meta.env.DEV;

  return async (request: Request): Promise<Response> => {
    const nonce = createNonce();
    const response = await handler(request, { context: { nonce } });
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.startsWith("text/html") ||
      response.headers.has("content-security-policy")
    ) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set(
      "Content-Security-Policy",
      contentSecurityPolicy({
        nonce,
        frameAncestors,
        turnstile,
        posthogHost,
        devServer,
      }),
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
