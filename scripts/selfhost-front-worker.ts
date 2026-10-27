/**
 * Front worker for the Docker self-host image.
 *
 * The image serves the built app with `wrangler dev`, which, unlike the
 * `vite preview` server the image used to run, neither checks the Host header
 * nor honours X-Forwarded-Proto. This worker is first in the wrangler dev
 * session, so it receives every request, and puts back what vite preview did
 * before a request reached the app:
 *
 * - The Host allowlist: IP addresses, localhost, *.localhost, ALLOWED_HOST and
 *   the BETTER_AUTH_URL hostname; anything else gets vite's 403 "Blocked
 *   request" (DNS-rebinding protection, which matters most in local_noauth).
 * - The request URL takes its protocol from X-Forwarded-Proto, so behind a TLS
 *   proxy the app sees https URLs, and X-Forwarded-Host defaults to Host.
 *
 * Everything else, including WebSocket upgrades and the cron trigger at
 * /cdn-cgi/handler/scheduled, passes to the app's worker unchanged. The image
 * bundles this file into dist/selfhost/front/ (scripts/selfhost-image.mjs).
 */

type AppService = Fetcher & {
  // Service bindings expose scheduled() under the
  // service_binding_extra_handlers compatibility flag.
  scheduled(options: { cron: string; scheduledTime: Date }): Promise<unknown>;
};

interface FrontEnv {
  APP: AppService;
  ALLOWED_HOST?: string;
  BETTER_AUTH_URL?: string;
}

const IPV4 =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIpv6(address: string) {
  try {
    return new URL(`http://[${address}]/`).hostname.length > 0;
  } catch {
    return false;
  }
}

// Port of vite 7's preview host check (host-validation-middleware).
export function isHostAllowed(
  hostHeader: string | null,
  allowedHosts: string[],
): boolean {
  if (hostHeader === null) return true;
  if (/^(?:file|.+-extension):/i.test(hostHeader)) return true;
  const host = hostHeader.trim();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 && isIpv6(host.slice(1, end));
  }
  const colon = host.indexOf(":");
  const hostname = colon === -1 ? host : host.slice(0, colon);
  if (IPV4.test(hostname)) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return allowedHosts.some(
    (allowed) =>
      allowed === hostname ||
      (allowed.startsWith(".") &&
        (allowed.slice(1) === hostname || hostname.endsWith(allowed))),
  );
}

// The same list vite.config.ts gave preview.allowedHosts.
export function allowedHostsFromEnv(env: FrontEnv): string[] {
  const hosts: string[] = [];
  if (env.ALLOWED_HOST) hosts.push(env.ALLOWED_HOST);
  if (env.BETTER_AUTH_URL) {
    try {
      hosts.push(new URL(env.BETTER_AUTH_URL).hostname);
    } catch {
      // vite.config.ts would have failed to start; the preflight reports it.
    }
  }
  return hosts;
}

function forwardedProtocol(header: string | null) {
  const first = header?.split(",")[0]?.trim().toLowerCase();
  return first === "http" || first === "https" ? `${first}:` : null;
}

function blockedResponse(hostHeader: string) {
  const hostname = JSON.stringify(hostHeader.replace(/:\d+$/, ""));
  return new Response(
    `Blocked request. This host (${hostname}) is not allowed.\nTo allow this host, set ALLOWED_HOST to ${hostname} in the container environment.`,
    { status: 403, headers: { "Content-Type": "text/plain" } },
  );
}

export default {
  fetch(request, env) {
    const host = request.headers.get("host");
    if (host !== null && !isHostAllowed(host, allowedHostsFromEnv(env))) {
      return blockedResponse(host);
    }
    const url = new URL(request.url);
    const protocol = forwardedProtocol(
      request.headers.get("x-forwarded-proto"),
    );
    if (protocol) url.protocol = protocol;
    const forwarded = new Request(url, request);
    if (host !== null && !forwarded.headers.has("x-forwarded-host")) {
      forwarded.headers.set("x-forwarded-host", host);
    }
    return env.APP.fetch(forwarded);
  },
  async scheduled(controller, env) {
    await env.APP.scheduled({
      cron: controller.cron,
      scheduledTime: new Date(controller.scheduledTime),
    });
  },
} satisfies ExportedHandler<FrontEnv>;
