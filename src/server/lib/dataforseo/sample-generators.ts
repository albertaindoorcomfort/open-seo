// Lunar Optimize sample data generators: the deterministic, made-up items
// behind each DataForSEO endpoint that sample.ts answers with. Domains sit on
// the reserved .example TLD and numbers are derived from the input, so nothing
// can pass for a measurement.

import {
  sampleKeywordMetric,
  sampleRankedKeywords,
  sampleSerp,
} from "@/lib/seo-engine";

export type Json = Record<string, unknown>;

export function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

/** A request field as text: strings and numbers only, anything else is absent. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick(
  text: string,
  salt: string,
  min: number,
  max: number,
): number {
  return min + (hash(`${salt}:${text}`) % (max - min + 1));
}

export function keywordOf(task: Json): string {
  const firstKeyword: unknown = Array.isArray(task.keywords)
    ? task.keywords[0]
    : undefined;
  const k =
    textOf(task.keyword) ??
    textOf(firstKeyword) ??
    textOf(task.target) ??
    "sample keyword";
  return k.trim().toLowerCase();
}

export function keywordData(keyword: string, task: Json) {
  const m = sampleKeywordMetric(keyword);
  return {
    se_type: "google",
    keyword: m.keyword,
    location_code: task.location_code ?? 2124,
    language_code: task.language_code ?? "en",
    keyword_info: {
      search_volume: m.search_volume,
      cpc: m.bid_high,
      competition: m.competition,
      competition_level:
        (m.competition ?? 0) > 0.66
          ? "HIGH"
          : (m.competition ?? 0) > 0.33
            ? "MEDIUM"
            : "LOW",
      low_top_of_page_bid: m.bid_low,
      high_top_of_page_bid: m.bid_high,
      monthly_searches: (m.monthly ?? []).map((x) => ({
        year: Number(x.period.slice(0, 4)),
        month: Number(x.period.slice(4)),
        search_volume: x.search_volume,
      })),
    },
    keyword_properties: {
      keyword_difficulty: m.difficulty,
      detected_language: task.language_code ?? "en",
    },
    search_intent_info: { main_intent: m.intent ?? "informational" },
  };
}

function organicItems(keyword: string, task: Json): Json[] {
  const serp = sampleSerp(
    keyword,
    Number(task.location_code ?? 2124),
    textOf(task.language_code) ?? "en",
  );
  return serp.organic.map((o) => ({
    type: "organic",
    rank_group: o.rank,
    rank_absolute: o.rank,
    position: "left",
    domain: o.domain,
    title: o.title,
    url: o.url,
    description: o.description,
    breadcrumb: o.url,
    is_featured_snippet: false,
  }));
}

export function serpResult(keyword: string, task: Json): Json {
  return {
    keyword,
    type: "organic",
    se_domain: "google.com",
    location_code: task.location_code ?? 2124,
    language_code: task.language_code ?? "en",
    check_url: "https://www.google.com/search?q=sample",
    datetime: new Date().toISOString(),
    item_types: ["organic", "people_also_ask"],
    se_results_count: 1_000_000,
    items_count: 10,
    items: organicItems(keyword, task),
  };
}

export function rankedKeywordItems(domain: string, task: Json): Json[] {
  return sampleRankedKeywords(domain, 30).map((r) => ({
    se_type: "google",
    keyword_data: keywordData(r.keyword, task),
    ranked_serp_element: {
      se_type: "google",
      serp_item: {
        type: "organic",
        url: r.url,
        relative_url: new URL(r.url ?? `https://${domain}/`).pathname,
        rank_absolute: r.rank,
        rank_group: r.rank,
        etv: Math.round((r.search_volume ?? 0) * (r.rank <= 3 ? 0.2 : 0.03)),
      },
    },
  }));
}

export function domainRankOverview(domain: string): Json {
  const count = pick(domain, "count", 120, 4200);
  return {
    se_type: "google",
    location_code: 2124,
    language_code: "en",
    metrics: {
      organic: {
        pos_1: pick(domain, "p1", 2, 40),
        pos_2_3: pick(domain, "p23", 5, 80),
        pos_4_10: pick(domain, "p410", 20, 300),
        pos_11_20: pick(domain, "p1120", 40, 600),
        etv: pick(domain, "etv", 300, 20_000),
        count,
        estimated_paid_traffic_cost: pick(domain, "cost", 500, 40_000),
        is_new: 0,
        is_up: pick(domain, "up", 10, 200),
        is_down: pick(domain, "down", 10, 200),
        is_lost: 0,
      },
      paid: { pos_1: 0, etv: 0, count: 0 },
    },
  };
}

export function backlinksSummary(target: string): Json {
  return {
    target,
    rank: pick(target, "rank", 50, 600),
    backlinks: pick(target, "bl", 200, 25_000),
    backlinks_spam_score: pick(target, "spam", 1, 30),
    crawled_pages: pick(target, "pages", 20, 900),
    broken_backlinks: pick(target, "broken", 0, 80),
    broken_pages: pick(target, "bpages", 0, 20),
    referring_domains: pick(target, "rd", 20, 900),
    referring_domains_nofollow: pick(target, "rdnf", 5, 200),
    referring_main_domains: pick(target, "rmd", 20, 800),
    referring_ips: pick(target, "ips", 15, 700),
    referring_subnets: pick(target, "subnets", 10, 500),
    referring_pages: pick(target, "rp", 100, 20_000),
    referring_links_tld: {
      com: pick(target, "tldc", 10, 400),
      ca: pick(target, "tlda", 5, 200),
    },
    referring_links_types: {
      anchor: pick(target, "anc", 100, 9000),
      image: pick(target, "img", 10, 900),
    },
    first_seen: "2021-03-01 00:00:00 +00:00",
  };
}

export function backlinkItems(target: string): Json[] {
  return Array.from({ length: 12 }, (_, i) => {
    const from = `sample-referrer-${i + 1}.example`;
    return {
      type: "backlink",
      domain_from: from,
      url_from: `https://${from}/article-${i + 1}`,
      domain_to: target,
      url_to: `https://${target}/`,
      anchor: `sample anchor ${i + 1}`,
      dofollow: i % 3 !== 0,
      rank: pick(`${target}${i}`, "brank", 10, 500),
      domain_from_rank: pick(`${target}${i}`, "drank", 10, 700),
      page_from_title: `Sample referring page ${i + 1}`,
      first_seen: "2025-06-01 00:00:00 +00:00",
      last_seen: "2026-10-01 00:00:00 +00:00",
      is_new: false,
      is_lost: false,
      item_type: "anchor",
    };
  });
}

export function referringDomainItems(target: string): Json[] {
  return Array.from({ length: 12 }, (_, i) => ({
    type: "backlinks_referring_domain",
    domain: `sample-referrer-${i + 1}.example`,
    rank: pick(`${target}${i}`, "rdrank", 10, 700),
    backlinks: pick(`${target}${i}`, "rdbl", 1, 120),
    first_seen: "2025-01-01 00:00:00 +00:00",
    lost_date: null,
    backlinks_spam_score: pick(`${target}${i}`, "rdspam", 0, 20),
    referring_domains: pick(`${target}${i}`, "rdrd", 1, 40),
  }));
}

/** Top pages for the backlinks page, most linked first, under the target's own domain. */
export function domainPageItems(target: string): Json[] {
  const top = pick(target, "pagebl", 200, 5000);
  return Array.from({ length: 10 }, (_, i) => ({
    type: "backlinks_domain_pages_summary",
    url: i === 0 ? `https://${target}/` : `https://${target}/sample-page-${i}`,
    backlinks: Math.round(top / (i + 1)),
    referring_domains: Math.round(pick(target, "pagerd", 20, 400) / (i + 1)),
    rank: pick(`${target}${i}`, "pagerank", 10, 500),
    broken_backlinks: pick(`${target}${i}`, "pagebroken", 0, 12),
  }));
}

export function backlinkHistory(target: string): Json[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 10 + i, 1));
    return {
      type: "backlinks_history",
      date: `${d.toISOString().slice(0, 10)} 00:00:00 +00:00`,
      rank: pick(`${target}${i}`, "hrank", 50, 600),
      backlinks:
        pick(target, "bl", 200, 25_000) -
        (11 - i) * pick(target, "step", 5, 40),
      referring_domains: pick(target, "rd", 20, 900) - (11 - i) * 2,
      new_backlinks: pick(`${target}${i}`, "nb", 0, 60),
      lost_backlinks: pick(`${target}${i}`, "lb", 0, 40),
    };
  });
}

export function competitorItems(keyword: string): Json[] {
  return Array.from({ length: 8 }, (_, i) => ({
    se_type: "google",
    domain: `sample-competitor-${i + 1}.example`,
    avg_position: pick(`${keyword}${i}`, "avg", 2, 30),
    median_position: pick(`${keyword}${i}`, "med", 2, 30),
    rating: pick(`${keyword}${i}`, "rating", 100, 900),
    etv: pick(`${keyword}${i}`, "cetv", 50, 9000),
    keywords_count: pick(`${keyword}${i}`, "kc", 3, 60),
    visibility: pick(`${keyword}${i}`, "vis", 1, 100) / 100,
    relevant_serp_items: pick(`${keyword}${i}`, "rel", 1, 40),
  }));
}
