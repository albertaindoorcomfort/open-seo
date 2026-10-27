// Lunar Optimize sample data: what DataForSEO would answer, made up, so every
// screen works end to end before a key or credits exist (owner, 2026-10-20).
//
// The authenticated fetch in core.ts returns these bodies instead of calling
// DataForSEO when DATAFORSEO_API_KEY is missing, or when DataForSEO refuses the
// call for auth, credits or quota. Each body has the real envelope shape (tasks,
// path, cost 0) so the existing parsers, billing and screens run unchanged, and
// carries `lunar_sample: true`. Domains sit on the reserved .example TLD and
// numbers are deterministic per keyword, so nothing can pass for a measurement.
// The app shows a "Sample data" banner while sample mode is active.

import { getRequiredEnvValue } from "@/server/lib/runtime-env";
import {
  sampleKeywordIdeas,
  sampleKeywordMetric,
  sampleRankedKeywords,
  sampleSerp,
} from "@/lib/seo-engine";

export type SampleReason = "no_key" | "auth" | "credits" | "quota";

let lastReason: SampleReason | null = null;

/** Why the most recent DataForSEO call in this process answered with sample data (null after a live answer). */
export function dataforseoSampleReason(): SampleReason | null {
  return lastReason;
}

export function markDataforseoLive(): void {
  lastReason = null;
}

export function setDataforseoSampleReason(reason: SampleReason): void {
  lastReason = reason;
}

/** True while DataForSEO answers with sample data: no key, or the latest call fell back. */
export async function inDataforseoSampleMode(): Promise<boolean> {
  if (lastReason !== null) return true;
  return (await readDataforseoKey()) === null;
}

/** The DataForSEO key, or null only when the variable is missing (sample mode). */
export async function readDataforseoKey(): Promise<string | null> {
  try {
    return (await getRequiredEnvValue("DATAFORSEO_API_KEY")) ?? "";
  } catch {
    return null;
  }
}

/** A deterministic sample rank (1-30, or null for "not in the top 100") for a tracked keyword. */
export function sampleRankPosition(keyword: string, device: string): number | null {
  const n = pick(keyword.trim().toLowerCase(), `rank:${device}`, 0, 34);
  return n > 30 ? null : n + 1;
}

/** DataForSEO HTTP or task status codes that mean "use sample data" rather than "fail the screen". */
export function sampleReasonFor(
  httpStatus: number,
  taskCode?: number,
): SampleReason | null {
  if (httpStatus === 401 || taskCode === 40100 || taskCode === 40101 || taskCode === 40104) return "auth";
  if (httpStatus === 402 || taskCode === 40200 || taskCode === 40210) return "credits";
  if (taskCode === 40202 || taskCode === 40209) return "quota";
  return null;
}

type Json = Record<string, unknown>;

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick(text: string, salt: string, min: number, max: number): number {
  return min + (hash(`${salt}:${text}`) % (max - min + 1));
}

function keywordOf(task: Json): string {
  const k = task.keyword ?? (Array.isArray(task.keywords) ? task.keywords[0] : undefined) ?? task.target ?? "sample keyword";
  return String(k).trim().toLowerCase();
}

function keywordData(keyword: string, task: Json): Json {
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
      competition_level: (m.competition ?? 0) > 0.66 ? "HIGH" : (m.competition ?? 0) > 0.33 ? "MEDIUM" : "LOW",
      low_top_of_page_bid: m.bid_low,
      high_top_of_page_bid: m.bid_high,
      monthly_searches: (m.monthly ?? []).map((x) => ({
        year: Number(x.period.slice(0, 4)),
        month: Number(x.period.slice(4)),
        search_volume: x.search_volume,
      })),
    },
    keyword_properties: { keyword_difficulty: m.difficulty, detected_language: task.language_code ?? "en" },
    search_intent_info: { main_intent: m.intent ?? "informational" },
  };
}

function organicItems(keyword: string, task: Json): Json[] {
  const serp = sampleSerp(keyword, Number(task.location_code ?? 2124), String(task.language_code ?? "en"));
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

function serpResult(keyword: string, task: Json): Json {
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

function rankedKeywordItems(domain: string, task: Json): Json[] {
  return sampleRankedKeywords(domain, 30).map((r) => ({
    se_type: "google",
    keyword_data: keywordData(r.keyword, task),
    ranked_serp_element: {
      se_type: "google",
      serp_item: { type: "organic", url: r.url, relative_url: new URL(r.url ?? `https://${domain}/`).pathname, rank_absolute: r.rank, rank_group: r.rank, etv: Math.round((r.search_volume ?? 0) * (r.rank <= 3 ? 0.2 : 0.03)) },
    },
  }));
}

function domainRankOverview(domain: string): Json {
  const count = pick(domain, "count", 120, 4200);
  return {
    se_type: "google",
    location_code: 2124,
    language_code: "en",
    metrics: {
      organic: {
        pos_1: pick(domain, "p1", 2, 40), pos_2_3: pick(domain, "p23", 5, 80), pos_4_10: pick(domain, "p410", 20, 300),
        pos_11_20: pick(domain, "p1120", 40, 600), etv: pick(domain, "etv", 300, 20_000), count,
        estimated_paid_traffic_cost: pick(domain, "cost", 500, 40_000), is_new: 0, is_up: pick(domain, "up", 10, 200), is_down: pick(domain, "down", 10, 200), is_lost: 0,
      },
      paid: { pos_1: 0, etv: 0, count: 0 },
    },
  };
}

function backlinksSummary(target: string): Json {
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
    referring_links_tld: { com: pick(target, "tldc", 10, 400), ca: pick(target, "tlda", 5, 200) },
    referring_links_types: { anchor: pick(target, "anc", 100, 9000), image: pick(target, "img", 10, 900) },
    first_seen: "2021-03-01 00:00:00 +00:00",
  };
}

function backlinkItems(target: string): Json[] {
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

function referringDomainItems(target: string): Json[] {
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

function backlinkHistory(target: string): Json[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 10 + i, 1));
    return {
      type: "backlinks_history",
      date: `${d.toISOString().slice(0, 10)} 00:00:00 +00:00`,
      rank: pick(`${target}${i}`, "hrank", 50, 600),
      backlinks: pick(target, "bl", 200, 25_000) - (11 - i) * pick(target, "step", 5, 40),
      referring_domains: pick(target, "rd", 20, 900) - (11 - i) * 2,
      new_backlinks: pick(`${target}${i}`, "nb", 0, 60),
      lost_backlinks: pick(`${target}${i}`, "lb", 0, 40),
    };
  });
}

function competitorItems(keyword: string): Json[] {
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

/** The result array for one endpoint path (the part after /v3/). */
function resultFor(path: string, task: Json): unknown[] {
  const kw = keywordOf(task);
  const target = String(task.target ?? kw).replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (/keyword_suggestions\/live|keyword_ideas\/live/.test(path)) {
    const items = [kw, ...sampleKeywordIdeas(kw, 12).map((k) => k.keyword)].map((k) => keywordData(k, task));
    return [{ seed_keyword: kw, total_count: items.length, items_count: items.length, items }];
  }
  if (/related_keywords\/live/.test(path)) {
    const items = sampleKeywordIdeas(kw, 12).map((k) => ({ se_type: "google", keyword_data: keywordData(k.keyword, task), depth: 1, related_keywords: [] }));
    return [{ seed_keyword: kw, total_count: items.length, items_count: items.length, items }];
  }
  if (/keyword_overview\/live/.test(path)) {
    const words = Array.isArray(task.keywords) ? task.keywords.map(String) : [kw];
    return [{ items: words.map((k) => keywordData(k.toLowerCase(), task)), items_count: words.length }];
  }
  if (/google_ads\/(search_volume|keywords_for_keywords)\/live/.test(path)) {
    const words = Array.isArray(task.keywords) ? task.keywords.map(String) : [kw];
    const list = /keywords_for_keywords/.test(path) ? [...words, ...sampleKeywordIdeas(words[0] ?? kw, 10).map((k) => k.keyword)] : words;
    return list.map((k) => {
      const d = keywordData(k.toLowerCase(), task);
      const info = d.keyword_info as Json;
      return { keyword: d.keyword, location_code: d.location_code, language_code: d.language_code, search_volume: info.search_volume, cpc: info.cpc, competition: info.competition_level, competition_index: Math.round(Number(info.competition) * 100), low_top_of_page_bid: info.low_top_of_page_bid, high_top_of_page_bid: info.high_top_of_page_bid, monthly_searches: info.monthly_searches };
    });
  }
  if (/domain_rank_overview\/live/.test(path)) return [{ target, total_count: 1, items_count: 1, items: [domainRankOverview(target)] }];
  if (/ranked_keywords\/live/.test(path)) {
    const items = rankedKeywordItems(target, task);
    return [{ target, total_count: items.length, items_count: items.length, items }];
  }
  if (/relevant_pages\/live/.test(path)) {
    const items = Array.from({ length: 8 }, (_, i) => ({ page_address: `https://${target}/sample-page-${i + 1}`, metrics: { organic: { count: pick(`${target}${i}`, "rpc", 3, 200), etv: pick(`${target}${i}`, "rpe", 10, 4000), pos_1: pick(`${target}${i}`, "rp1", 0, 10) } } }));
    return [{ target, total_count: items.length, items_count: items.length, items }];
  }
  if (/serp_competitors\/live/.test(path)) {
    const items = competitorItems(kw);
    return [{ total_count: items.length, items_count: items.length, items }];
  }
  if (/serp\/google\/organic\/(live\/advanced|task_get\/advanced)/.test(path)) return [serpResult(kw, task)];
  if (/serp\/google\/organic\/task_post/.test(path)) return [];
  if (/backlinks\/summary\/live/.test(path)) return [backlinksSummary(target)];
  if (/backlinks\/backlinks\/live/.test(path)) {
    const items = backlinkItems(target);
    return [{ target, total_count: items.length, items_count: items.length, items }];
  }
  if (/backlinks\/referring_domains\/live/.test(path)) {
    const items = referringDomainItems(target);
    return [{ target, total_count: items.length, items_count: items.length, items }];
  }
  if (/backlinks\/history\/live/.test(path)) {
    const items = backlinkHistory(target);
    return [{ target, total_count: items.length, items_count: items.length, items }];
  }
  if (/locations/.test(path)) {
    return [{ location_code: 2124, location_name: "Canada", location_code_parent: null, country_iso_code: "CA", location_type: "Country" }, { location_code: 2840, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" }];
  }
  return [{ total_count: 0, items_count: 0, items: [] }];
}

/** A DataForSEO-shaped response body for the request, marked as sample data. */
export function sampleDataforseoBody(url: string, requestBody: unknown): Json {
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const rel = pathname.replace(/^\/v3\//, "");
  const tasks = (Array.isArray(requestBody) && requestBody.length > 0 ? requestBody : [{}]).map((t, i) => {
    const task = (t ?? {}) as Json;
    const result = resultFor(rel, task);
    return {
      id: `sample-${hash(`${rel}${i}${JSON.stringify(task)}`).toString(16)}`,
      status_code: 20000,
      status_message: "Ok.",
      time: "0 sec.",
      cost: 0,
      result_count: result.length,
      path: rel.split("/"),
      data: { api: rel.split("/")[0], function: rel, ...task },
      result,
    };
  });
  return {
    version: "0.1.sample",
    status_code: 20000,
    status_message: "Ok.",
    time: "0 sec.",
    cost: 0,
    tasks_count: tasks.length,
    tasks_error: 0,
    tasks,
    lunar_sample: true,
  };
}

/** Parse a fetch body (string or JSON-ish) for sample generation; anything else is treated as no tasks. */
export function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return [];
  try {
    return JSON.parse(body);
  } catch {
    return [];
  }
}
