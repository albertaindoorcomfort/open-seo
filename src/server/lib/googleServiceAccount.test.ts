import { describe, expect, it } from "vitest";
import {
  parseServiceAccountConfig,
  signServiceAccountAssertion,
} from "./googleServiceAccount";

async function makeKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  const body = btoa(String.fromCharCode(...pkcs8));
  const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

function decode(part: string): unknown {
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
}

describe("parseServiceAccountConfig", () => {
  it("needs both a valid key and at least one allowed user", async () => {
    const { pem } = await makeKey();
    const key = JSON.stringify({
      client_email: "reader@example.iam.gserviceaccount.com",
      private_key: pem,
    });
    expect(parseServiceAccountConfig(key, undefined)).toBeNull();
    expect(parseServiceAccountConfig(key, " , ")).toBeNull();
    expect(parseServiceAccountConfig("not json", "a@b.co")).toBeNull();
    const config = parseServiceAccountConfig(key, "Owner@Example.com, b@c.co");
    expect([...(config?.allowedEmails ?? [])]).toEqual([
      "owner@example.com",
      "b@c.co",
    ]);
  });
});

describe("signServiceAccountAssertion", () => {
  it("signs an RS256 JWT bearer assertion Google can verify", async () => {
    const { pem, publicKey } = await makeKey();
    const jwt = await signServiceAccountAssertion(
      {
        client_email: "reader@example.iam.gserviceaccount.com",
        private_key: pem,
      },
      "https://www.googleapis.com/auth/webmasters.readonly",
      1_700_000_000,
    );
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(claims)).toMatchObject({
      iss: "reader@example.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      exp: 1_700_003_600,
    });
    const sig = Uint8Array.from(
      atob(signature.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      sig,
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });
});
