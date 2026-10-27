/**
 * Keyword and SERP research contracts, plus the pure rules that combine provider answers.
 *
 * Providers (Google Ads Keyword Planner for volume and bid ranges, DataForSEO for ideas, difficulty and SERPs,
 * Search Console for the site's own queries) are adapters elsewhere; this module only defines what they return
 * and how answers are merged. A provider that is not set up answers not_configured, and no rule here ever fills a
 * missing number.
 */

export type VolumeSource = "google_ads" | "dataforseo" | "sample";

export interface MonthlyVolume {
  /** YYYYMM */
  period: string;
  search_volume: number;
}

export interface KeywordMetric {
  keyword: string;
  search_volume?: number;
  volume_source?: VolumeSource;
  /** Google Ads top-of-page bid range in account currency. */
  bid_low?: number;
  bid_high?: number;
  /** DataForSEO's average cost per click, used only when Keyword Planner is not configured. */
  cpc?: number;
  /** 0-1 advertiser competition. */
  competition?: number;
  /** 0-100 organic difficulty (DataForSEO). */
  difficulty?: number;
  intent?: "informational" | "navigational" | "commercial" | "transactional";
  intent_source?: "provider" | "rule";
  monthly?: MonthlyVolume[];
  /** Set on sample-data rows; never present on a measurement. */
  sample?: true;
}

export interface SerpItem {
  rank: number;
  url: string;
  domain: string;
  title: string;
  description?: string;
}

export interface SerpResult {
  keyword: string;
  location_code: number;
  language_code: string;
  organic: SerpItem[];
  /** SERP feature types present (featured_snippet, people_also_ask, local_pack, video, ...). */
  features: string[];
  people_also_ask: string[];
}

export interface RankedKeyword {
  keyword: string;
  rank: number;
  url?: string;
  search_volume?: number;
}

/** Why a provider did not answer, so a chain can fall through and the Data sources panel can say what to fix. */
export type FailureCode = "auth" | "credits" | "quota" | "provider";

export type ProviderOutcome<T> =
  | {
      status: "ok";
      provider: string;
      method: string;
      data: T;
      cost_usd: number | null;
      captured_at: string;
      /** True for the sample-data provider: deterministic placeholder rows, never real measurements. */
      sample?: boolean;
    }
  | { status: "not_configured"; provider: string; reason: string }
  | { status: "error"; provider: string; reason: string; code?: FailureCode };

export interface CostLine {
  provider: string;
  operation: string;
  estimated_usd: number;
  basis: string;
}

export const RESEARCH_DEFAULTS = {
  location_code: 2124, // Canada (Google geo target id; DataForSEO uses the same ids)
  language_code: "en",
} as const;

/** Google Search Console quick wins: a page ranking 5-20 with real impressions. */
export const STRIKING_DISTANCE = { minPosition: 5, maxPosition: 20, minImpressions: 20 } as const;

export interface SearchQueryRow {
  query: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  sample?: true;
}

export function strikingDistance(rows: SearchQueryRow[], limit = 20): SearchQueryRow[] {
  return rows
    .filter((r) => r.position >= STRIKING_DISTANCE.minPosition && r.position <= STRIKING_DISTANCE.maxPosition && r.impressions >= STRIKING_DISTANCE.minImpressions)
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    .slice(0, limit);
}

const INTENT_RULES: Array<[NonNullable<KeywordMetric["intent"]>, RegExp]> = [
  ["transactional", /\b(buy|price|prices|pricing|cost|costs|quote|quotes|near me|hire|book|order|cheap|deal|deals|discount|coupon|for sale)\b/],
  ["commercial", /\b(best|top|vs|versus|review|reviews|compare|comparison|alternative|alternatives|rated)\b/],
  ["navigational", /\b(login|log in|sign in|website|official|contact|phone number|hours)\b/],
  ["informational", /^(how|what|why|when|where|who|which|can|does|is|are|should)\b|\b(guide|tips|ideas|meaning|definition|examples|tutorial)\b/],
];

/** Intent from the words of the query, used only when the provider gives none. */
export function intentFromModifiers(keyword: string): KeywordMetric["intent"] | undefined {
  const k = keyword.toLowerCase();
  for (const [intent, rule] of INTENT_RULES) if (rule.test(k)) return intent;
  return undefined;
}

/**
 * Merge keyword rows from the idea/difficulty provider with a volume answer (Keyword Planner first in the chain).
 * When a volume answer is given it is the only volume and bid source: the ideas' own volume and CPC are dropped even
 * where it has no row, so two sources never mix in one table. Without one, the ideas' DataForSEO volume stays,
 * labelled as its source.
 */
export function mergeKeywordMetrics(ideas: KeywordMetric[], plannerVolume: KeywordMetric[] | null, volumeSource: VolumeSource = "google_ads"): KeywordMetric[] {
  const byKeyword = new Map<string, KeywordMetric>();
  for (const idea of ideas) {
    const key = idea.keyword.trim().toLowerCase();
    if (!key || byKeyword.has(key)) continue;
    const row: KeywordMetric = { ...idea, keyword: key };
    if (plannerVolume) {
      delete row.search_volume;
      delete row.volume_source;
      delete row.cpc;
      delete row.monthly;
    } else if (row.search_volume != null) {
      row.volume_source = "dataforseo";
    }
    byKeyword.set(key, row);
  }
  if (plannerVolume) {
    for (const p of plannerVolume) {
      const key = p.keyword.trim().toLowerCase();
      if (!key) continue;
      const existing = byKeyword.get(key) ?? { keyword: key };
      byKeyword.set(key, {
        ...existing,
        search_volume: p.search_volume,
        volume_source: p.search_volume != null ? volumeSource : undefined,
        bid_low: p.bid_low,
        bid_high: p.bid_high,
        cpc: p.cpc,
        competition: p.competition ?? existing.competition,
        monthly: p.monthly,
      });
    }
  }
  for (const row of byKeyword.values()) {
    if (!row.intent) {
      const rule = intentFromModifiers(row.keyword);
      if (rule) { row.intent = rule; row.intent_source = "rule"; }
    } else if (!row.intent_source) {
      row.intent_source = "provider";
    }
  }
  return [...byKeyword.values()].sort((a, b) => (b.search_volume ?? -1) - (a.search_volume ?? -1) || a.keyword.localeCompare(b.keyword));
}

export interface SerpDomain {
  domain: string;
  results: number;
  best_rank: number;
}

export function serpDomains(serp: SerpResult): SerpDomain[] {
  const map = new Map<string, SerpDomain>();
  for (const item of serp.organic) {
    const d = item.domain.toLowerCase().replace(/^www\./, "");
    const cur = map.get(d);
    if (cur) { cur.results += 1; cur.best_rank = Math.min(cur.best_rank, item.rank); }
    else map.set(d, { domain: d, results: 1, best_rank: item.rank });
  }
  return [...map.values()].sort((a, b) => a.best_rank - b.best_rank);
}

export interface GapKeyword {
  keyword: string;
  competitors: Array<{ domain: string; rank: number; url?: string }>;
  best_rank: number;
  search_volume?: number;
}

/**
 * Content gap: keywords at least one competitor ranks for (top 20 by default) that the site does not cover. "Covers"
 * means the keyword appears among the site's own ranked keywords or Search Console queries.
 */
export function contentGap(
  competitors: Array<{ domain: string; keywords: RankedKeyword[] }>,
  ownKeywords: string[],
  options: { maxRank?: number; limit?: number } = {},
): GapKeyword[] {
  const maxRank = options.maxRank ?? 20;
  const own = new Set(ownKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const gaps = new Map<string, GapKeyword>();
  for (const c of competitors) {
    for (const k of c.keywords) {
      const key = k.keyword.trim().toLowerCase();
      if (!key || own.has(key) || k.rank > maxRank) continue;
      const g = gaps.get(key) ?? { keyword: key, competitors: [], best_rank: k.rank, search_volume: k.search_volume };
      g.competitors.push({ domain: c.domain, rank: k.rank, url: k.url });
      g.best_rank = Math.min(g.best_rank, k.rank);
      if (g.search_volume == null && k.search_volume != null) g.search_volume = k.search_volume;
      gaps.set(key, g);
    }
  }
  return [...gaps.values()]
    .sort((a, b) => b.competitors.length - a.competitors.length || (b.search_volume ?? 0) - (a.search_volume ?? 0) || a.best_rank - b.best_rank)
    .slice(0, options.limit ?? 50);
}

/** Keep a seed keyword to what a person would type: 2-80 characters, no URLs or control characters. */
export function normaliseSeed(raw: string): string | null {
  const s = raw.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (s.length < 2 || s.length > 80) return null;
  if (/https?:\/\/|www\./.test(s)) return null;
  return s;
}

/** A bare domain from user input ("https://www.Example.com/x" -> "example.com"); null when it is not a public name. */
export function normaliseDomain(raw: string): string | null {
  let host = raw.trim().toLowerCase();
  try {
    host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host;
}
