// Guard for every server-side fetch of a URL a person (or a page they point
// us at) supplied: the site audit's start URL, each crawled link and redirect
// hop, robots.txt and sitemaps, the chat agents' page reads and the content
// score reference pages.
//
// On the Studio box the app runs under wrangler dev, where fetch() reaches
// loopback and private addresses: a local wrangler dev probe on 2026-10-27,
// with the global_fetch_strictly_public flag set, got answers from
// http://127.0.0.1:<port>/, http://localhost:<port>/ and
// http://2130706433:<port>/. So nothing here relies on the runtime. Before
// any request leaves, a URL must:
// - use http or https, on the default ports (80 and 443) only;
// - name a host that is not localhost, *.localhost, an internal suffix or a
//   single label (the box resolver's search domains could expand it);
// - be a public unicast address, or a name whose every DNS answer is one.
//   Loopback, private, link-local, CGNAT, multicast, unspecified, reserved,
//   IPv4-mapped/compatible/NAT64 IPv6 and cloud metadata addresses
//   (169.254.169.254, fd00:ec2::254) are refused;
// - resolve: DNS is asked over HTTPS first, and a name with no answer, or a
//   resolver failure, is refused (fail closed).
// Redirects are followed by hand and each hop is checked again.
//
// Known limit: workerd's fetch() cannot be pinned to the checked address, so
// the runtime resolves the name again when it connects. A name that answers
// differently the second time (DNS rebinding) can still slip past this check.
// The port rule keeps such a request off the box's app ports (Studio :3000
// and the like); a network rule on the service (systemd IPAddressDeny for
// private and link-local ranges) is the layer that closes the rest.

import { z } from "zod";
import { AppError } from "@/server/lib/errors";

/** Looks up every A and AAAA address of a hostname. Throws when it cannot. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

const ALLOWED_PORTS = new Set(["", "80", "443"]);
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".home.arpa",
];

function parseIpv4(text: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null;
  const parts = text.split(".").map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

function isPublicIpv4([a, b, c]: number[]): boolean {
  return !(
    a === 0 || // "this network", 0.0.0.0
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast, reserved, broadcast
    (a === 100 && b >= 64 && b <= 127) || // CGNAT (and 100.100.100.200 metadata)
    (a === 169 && b === 254) || // link-local, 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

const groupsOf = (part: string) => (part === "" ? [] : part.split(":"));

/** Eight 16-bit groups, or null. Accepts "::" and a dotted IPv4 tail. */
function parseIpv6(value: string): number[] | null {
  let text = value;
  const lastColon = text.lastIndexOf(":");
  if (lastColon === -1) return null;
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = groupsOf(halves[0]);
  const rest = halves.length === 2 ? groupsOf(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...rest];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function isPublicIpv6([a, b]: number[]): boolean {
  // Only global unicast (2000::/3). Everything else is refused: ::, ::1,
  // IPv4-mapped and -compatible, NAT64 64:ff9b::, discard 100::, ULA fc00::/7
  // (fd00:ec2::254 metadata), link-local, site-local and multicast.
  if ((a & 0xe000) !== 0x2000) return false;
  if (a === 0x2001 && b < 0x0200) return false; // 2001::/23, Teredo
  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if (a === 0x2002) return false; // 6to4 carries an IPv4 address
  if ((a & 0xfff0) === 0x3ff0) return false; // 3fff::/20 documentation
  return true;
}

/** True only for a public unicast IPv4 or IPv6 address. */
export function isPublicAddress(address: string): boolean {
  const text = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(text);
  if (v4) return isPublicIpv4(v4);
  const v6 = parseIpv6(text);
  return v6 !== null && isPublicIpv6(v6);
}

function isIpLiteral(host: string): boolean {
  return host.includes(":") || parseIpv4(host) !== null;
}

/** URL.hostname without IPv6 brackets or a trailing root dot. */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/**
 * The checks that need no DNS: scheme, port and host shape. URL parsing has
 * already turned decimal, octal and hex IPv4 forms (http://2130706433/,
 * http://0x7f.1/) into dotted quads, so those meet the address rules here.
 * Returns the parsed URL, or null when it must not be fetched.
 */
export function publicUrlOrNull(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!ALLOWED_PORTS.has(url.port)) return null;
  const host = hostOf(url);
  if (isIpLiteral(host)) return isPublicAddress(host) ? url : null;
  if (!host.includes(".")) return null;
  if (host === "localhost") return null;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return null;
  }
  return url;
}

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 5_000;
const DNS_CACHE_MS = 30_000;
const DNS_CACHE_MAX = 500;

const dohResponseSchema = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
});

async function queryDoh(hostname: string, type: "A" | "AAAA") {
  const response = await fetch(
    `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`DNS lookup answered ${response.status}`);
  const body = dohResponseSchema.parse(await response.json());
  if (body.Status === 3) return []; // NXDOMAIN
  if (body.Status !== 0) throw new Error(`DNS lookup status ${body.Status}`);
  const wanted = type === "A" ? 1 : 28;
  return (body.Answer ?? [])
    .filter((answer) => answer.type === wanted)
    .map((answer) => answer.data);
}

// One retry for a resolver blip (timeout, 5xx, SERVFAIL), so a short outage
// does not drop pages from a running audit. A second failure still fails
// closed.
const DOH_RETRY_DELAY_MS = 250;

async function queryDohWithRetry(hostname: string, type: "A" | "AAAA") {
  try {
    return await queryDoh(hostname, type);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, DOH_RETRY_DELAY_MS));
    return queryDoh(hostname, type);
  }
}

// A crawl asks about the same host for every page, so answers are kept for
// a short while. Only settled values are kept: workerd does not let one
// request await a promise another request started.
const dnsCache = new Map<string, { expiresAt: number; addresses: string[] }>();

/** The default resolver: Cloudflare DNS over HTTPS, A and AAAA. */
const resolveHostOverHttps: ResolveHost = async (hostname) => {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;
  const [v4, v6] = await Promise.all([
    queryDohWithRetry(hostname, "A"),
    queryDohWithRetry(hostname, "AAAA"),
  ]);
  const addresses = [...v4, ...v6];
  if (dnsCache.size >= DNS_CACHE_MAX) dnsCache.clear();
  dnsCache.set(hostname, {
    expiresAt: Date.now() + DNS_CACHE_MS,
    addresses,
  });
  return addresses;
};

/**
 * Throws AppError CRAWL_TARGET_BLOCKED unless the URL passes the shape checks
 * and its host resolves only to public addresses. Returns the parsed URL.
 */
export async function assertPublicUrl(
  input: string,
  resolve: ResolveHost = resolveHostOverHttps,
): Promise<URL> {
  const url = publicUrlOrNull(input);
  if (!url) throw new AppError("CRAWL_TARGET_BLOCKED");
  const host = hostOf(url);
  if (isIpLiteral(host)) return url;

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new AppError("CRAWL_TARGET_BLOCKED");
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new AppError("CRAWL_TARGET_BLOCKED");
  }
  return url;
}

/**
 * fetch() for a user-supplied URL. Each hop is checked with assertPublicUrl
 * before it is requested, and up to maxRedirects redirects are followed by
 * hand (0 hands a 3xx back unfollowed). Returns the last response and the URL
 * that gave it. Throws AppError CRAWL_TARGET_BLOCKED when a hop is refused.
 */
export async function guardedFetch(
  input: string,
  init: Omit<RequestInit, "redirect">,
  options: { maxRedirects: number; resolve?: ResolveHost },
): Promise<{ response: Response; url: string }> {
  const resolve = options.resolve ?? resolveHostOverHttps;
  let url = (await assertPublicUrl(input, resolve)).toString();
  for (let hop = 0; ; hop += 1) {
    const response = await fetch(url, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect || !location || hop >= options.maxRedirects) {
      return { response, url };
    }
    await response.body?.cancel();
    let next: string;
    try {
      next = new URL(location, url).toString();
    } catch {
      throw new AppError("CRAWL_TARGET_BLOCKED");
    }
    url = (await assertPublicUrl(next, resolve)).toString();
  }
}
