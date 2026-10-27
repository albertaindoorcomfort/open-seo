// No test may spend money. Paid data providers' hosts are blocked for the whole
// suite: a test that reaches one without stubbing fetch fails, naming the host.
// Tests that stub fetch (vi.stubGlobal) replace this wrapper, so mocks work.
export const PAID_HOSTS = [
  "api.dataforseo.com",
  "googleads.googleapis.com",
  "openrouter.ai",
  "api.search.brave.com",
] as const;

export class PaidNetworkBlocked extends Error {
  constructor(host: string) {
    super(
      `Test tried a real network call to the paid provider ${host}. Stub fetch instead.`,
    );
    this.name = "PaidNetworkBlocked";
  }
}

function hostOf(input: unknown): string | null {
  try {
    if (typeof input === "string") return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (
      input &&
      typeof input === "object" &&
      "url" in input &&
      typeof input.url === "string"
    )
      return new URL(input.url).hostname;
  } catch {
    return null;
  }
  return null;
}

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const host = hostOf(input);
    if (host && (PAID_HOSTS as readonly string[]).includes(host))
      return Promise.reject(new PaidNetworkBlocked(host));
    return realFetch(input, init);
  }) as typeof fetch;
}
