import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Server-to-server Google access for a single-tenant instance. A service
// account added as a user on the Search Console property and the GA4 property
// reads them without a per-user OAuth grant, so nothing expires every 7 days
// while the OAuth app is unverified. It appears beside OAuth grants as one
// more "account" whose id starts with SERVICE_ACCOUNT_PREFIX, and only the
// emails in GOOGLE_SERVICE_ACCOUNT_USERS may see or use it. Unset or malformed
// config means no service account, never a partial one.

export const SERVICE_ACCOUNT_PREFIX = "service-account:";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GSC_SERVICE_ACCOUNT_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";
export const GA4_SERVICE_ACCOUNT_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";

const keySchema = z.object({
  client_email: z.email(),
  private_key: z.string().includes("PRIVATE KEY"),
  token_uri: z.url().optional(),
});

type ServiceAccountKey = z.infer<typeof keySchema>;

type ServiceAccountConfig = {
  key: ServiceAccountKey;
  allowedEmails: Set<string>;
};

export function parseServiceAccountConfig(
  rawKey: string | undefined,
  rawUsers: string | undefined,
): ServiceAccountConfig | null {
  if (!rawKey || !rawUsers) return null;
  const allowedEmails = new Set(
    rawUsers
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedEmails.size === 0) return null;
  try {
    const key = keySchema.parse(JSON.parse(rawKey));
    return { key, allowedEmails };
  } catch {
    console.error(
      "[google-service-account] GOOGLE_SERVICE_ACCOUNT_JSON is not a valid key; service account disabled",
    );
    return null;
  }
}

export async function loadServiceAccountConfig(): Promise<ServiceAccountConfig | null> {
  return parseServiceAccountConfig(
    await getOptionalEnvValue("GOOGLE_SERVICE_ACCOUNT_JSON"),
    await getOptionalEnvValue("GOOGLE_SERVICE_ACCOUNT_USERS"),
  );
}

export function isServiceAccountId(accountId: string | null | undefined) {
  return Boolean(accountId?.startsWith(SERVICE_ACCOUNT_PREFIX));
}

function base64Url(bytes: Uint8Array | string): string {
  const raw =
    typeof bytes === "string"
      ? bytes
      : Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

export async function signServiceAccountAssertion(
  key: ServiceAccountKey,
  scope: string,
  nowSeconds: number,
): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: key.token_uri ?? GOOGLE_TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(key.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Mints (and caches until a minute before expiry) an access token for one scope. */
export async function getServiceAccountAccessToken(
  scope: string,
): Promise<string> {
  const config = await loadServiceAccountConfig();
  if (!config) throw new Error("No Google service account is configured.");
  const cacheKey = `${config.key.client_email} ${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const assertion = await signServiceAccountAssertion(
    config.key,
    scope,
    Math.floor(Date.now() / 1000),
  );
  const response = await fetch(config.key.token_uri ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Google refused the service account token (${response.status}).`,
    );
  }
  const data = z
    .object({ access_token: z.string(), expires_in: z.number() })
    .parse(await response.json());
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
