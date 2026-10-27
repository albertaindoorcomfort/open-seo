// Content score reference pages: fetch the competitor pages a person names and
// reduce each to counts (terms, words, headings) with the Lunar SEO engine.
//
// Every hop goes through the same SSRF guard as the site audit
// (normalizeAndValidateStartUrl: public hosts only, private IPs blocked, DNS
// checked over DoH), redirects are followed by hand and re-validated, and each
// body is capped. Page text is untrusted: it is measured, never followed, and
// never stored or returned; only the profile counts leave this module.

import {
  buildReference,
  parseHtmlPage,
  parsePlainText,
  profilePage,
  type ContentReference,
  type ReferencePage,
} from "@/lib/seo-engine";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;
const USER_AGENT = "LunarOptimize-ContentScore/1.0";

export type PageAttempt = { url: string; ok: boolean; error?: string };

async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchPage(rawUrl: string): Promise<{ ok: true; url: string; html: boolean; body: string } | { ok: false; error: string }> {
  let current: string;
  try {
    current = await normalizeAndValidateStartUrl(rawUrl);
  } catch {
    return { ok: false, error: "That address cannot be fetched." };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: "The page could not be reached." };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, error: "The page redirected without a destination." };
      try {
        current = await normalizeAndValidateStartUrl(new URL(location, current).toString());
      } catch {
        return { ok: false, error: "The page redirected to an address that cannot be fetched." };
      }
      continue;
    }
    if (!response.ok) return { ok: false, error: `The page answered ${response.status}.` };
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("text/html") && !type.startsWith("text/plain")) return { ok: false, error: "Only web pages can be measured." };
    const body = await readCapped(response);
    if (body === null) return { ok: false, error: "The page is larger than 2 MB." };
    return { ok: true, url: current, html: type.startsWith("text/html"), body };
  }
  return { ok: false, error: "The page redirected too many times." };
}

/** Build the reference for a keyword from up to five competitor pages (fetched) and pasted reference texts. */
export async function buildContentReferenceFromPages(input: {
  keyword: string;
  urls: string[];
  texts?: Array<{ title: string; text: string }>;
}): Promise<{ reference: ContentReference; attempts: PageAttempt[] }> {
  const urls = [...new Set(input.urls.map((u) => u.trim()).filter(Boolean))].slice(0, 5);
  const attempts: PageAttempt[] = [];
  const pages: ReferencePage[] = [];
  const results = await Promise.all(urls.map((u) => fetchPage(u)));
  results.forEach((r, i) => {
    const url = urls[i] ?? "";
    if (!r.ok) {
      attempts.push({ url, ok: false, error: r.error });
      return;
    }
    const doc = r.html ? parseHtmlPage(r.body) : parsePlainText(new URL(r.url).hostname, r.body);
    if (doc.word_count < 50) {
      attempts.push({ url, ok: false, error: "The page has too little readable text." });
      return;
    }
    pages.push(profilePage(r.url, doc, "provided"));
    attempts.push({ url, ok: true });
  });
  for (const t of (input.texts ?? []).slice(0, 5)) {
    const doc = parsePlainText(t.title, t.text);
    if (doc.word_count >= 50) pages.push(profilePage(`text:${t.title.slice(0, 60)}`, doc, "source"));
  }
  return { reference: buildReference(input.keyword.trim().toLowerCase(), pages), attempts };
}
