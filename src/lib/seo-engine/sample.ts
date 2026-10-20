/**
 * Sample data for every research capability, used when no provider with a key (or credit) can answer.
 *
 * Deterministic: the same seed always gives the same rows, so screens and tests are stable. Every number is made up
 * and every URL sits on the reserved .example domain (it can never resolve). Callers label the answer "Sample data"
 * and never store it as a measurement.
 */
import { intentFromModifiers, type KeywordMetric, type RankedKeyword, type SearchQueryRow, type SerpResult } from "./research";

export const SAMPLE_METHOD = "placeholder_sample_v1" as const;

/** FNV-1a: a small stable hash, so sample numbers depend only on the text. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A number in [min, max] from the text and a salt. */
function pick(text: string, salt: string, min: number, max: number): number {
  return min + (hash(`${salt}:${text}`) % (max - min + 1));
}

const MODIFIERS = ["cost", "near me", "best", "how to choose", "vs alternatives", "price", "installation", "repair", "guide", "reviews", "rebates", "maintenance"];

function monthly(keyword: string, base: number): Array<{ period: string; search_volume: number }> {
  const out = [];
  for (let m = 1; m <= 12; m += 1) {
    const swing = pick(keyword, `m${m}`, 70, 130) / 100;
    out.push({ period: `2026${String(m).padStart(2, "0")}`, search_volume: Math.round(base * swing) });
  }
  return out;
}

export function sampleKeywordMetric(keyword: string): KeywordMetric {
  const k = keyword.trim().toLowerCase();
  const volume = pick(k, "vol", 3, 160) * 10;
  const intent = intentFromModifiers(k);
  return {
    keyword: k,
    search_volume: volume,
    bid_low: pick(k, "bl", 40, 220) / 100,
    bid_high: pick(k, "bh", 240, 900) / 100,
    competition: pick(k, "comp", 5, 95) / 100,
    difficulty: pick(k, "kd", 4, 78),
    intent,
    intent_source: intent ? "rule" : undefined,
    monthly: monthly(k, volume),
  };
}

export function sampleKeywordIdeas(seed: string, limit = 12): KeywordMetric[] {
  const s = seed.trim().toLowerCase();
  return MODIFIERS.slice(0, Math.max(1, Math.min(limit, MODIFIERS.length))).map((m) => sampleKeywordMetric(`${s} ${m}`));
}

export function sampleVolume(keywords: string[]): KeywordMetric[] {
  return keywords.map((k) => {
    const full = sampleKeywordMetric(k);
    return { keyword: full.keyword, search_volume: full.search_volume, bid_low: full.bid_low, bid_high: full.bid_high, competition: full.competition, monthly: full.monthly };
  });
}

export function sampleSerp(keyword: string, location_code: number, language_code: string): SerpResult {
  const k = keyword.trim().toLowerCase();
  const slug = k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const organic = Array.from({ length: 10 }, (_, i) => {
    const site = `sample-site-${(pick(k, `d${i}`, 1, 9) + i) % 10 + 1}.example`;
    return {
      rank: i + 1,
      url: `https://${site}/${slug}`,
      domain: site,
      title: `Sample result ${i + 1}: ${k}`,
      description: "Sample data. Connect a SERP provider to see the real results page.",
    };
  });
  return {
    keyword: k,
    location_code,
    language_code,
    organic,
    features: ["people_also_ask", ...(pick(k, "fs", 0, 1) ? ["featured_snippet"] : [])],
    people_also_ask: [`How much does ${k} cost?`, `Is ${k} worth it?`, `What should I ask before ${k}?`],
  };
}

export function sampleRankedKeywords(domain: string, limit = 30): RankedKeyword[] {
  const d = domain.trim().toLowerCase();
  const stem = d.split(".")[0].replace(/[^a-z]+/g, " ").trim() || "service";
  return MODIFIERS.concat(["emergency", "financing", "warranty", "replacement"]).slice(0, limit).map((m, i) => ({
    keyword: `${stem} ${m}`,
    rank: pick(d, `r${i}`, 1, 20),
    url: `https://${d}/${m.replace(/\s+/g, "-")}`,
    search_volume: pick(`${stem} ${m}`, "vol", 3, 160) * 10,
  }));
}

export function sampleSearchQueries(seed: string): SearchQueryRow[] {
  const s = seed.trim().toLowerCase();
  return MODIFIERS.slice(0, 8).map((m, i) => {
    const impressions = pick(`${s} ${m}`, "imp", 25, 900);
    const position = pick(`${s} ${m}`, "pos", 30, 190) / 10;
    const clicks = Math.round(impressions * (position < 10 ? 0.04 : 0.01));
    return {
      query: `${s} ${m}`,
      page: `https://your-site.example/${s.replace(/[^a-z0-9]+/g, "-")}${i ? `-${i}` : ""}`,
      clicks,
      impressions,
      ctr: Math.round((clicks / impressions) * 1000) / 1000,
      position,
    };
  });
}
