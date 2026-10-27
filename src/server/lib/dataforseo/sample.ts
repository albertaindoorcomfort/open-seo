// Lunar Optimize sample data: what DataForSEO would answer, made up, so every
// screen works end to end before a key or credits exist (owner, 2026-10-20).
//
// The authenticated fetch in core.ts returns these bodies instead of calling
// DataForSEO when DATAFORSEO_API_KEY is missing, or when DataForSEO refuses the
// call for auth, credits or quota. Each body has the real envelope shape (tasks,
// path, cost 0) so the existing parsers, billing and screens run unchanged, and
// carries `lunar_sample: true`. Domains sit on the reserved .example TLD and
// numbers are deterministic per keyword, so nothing can pass for a measurement.
// Whether an answer was sample data is recorded per request (sample-scope.ts),
// and the "Sample data" banner shows for the browser that received it.

import { getRequiredEnvValue } from "@/server/lib/runtime-env";
import { sampleKeywordIdeas } from "@/lib/seo-engine";
import {
  backlinkHistory,
  backlinkItems,
  backlinksSummary,
  competitorItems,
  domainRankOverview,
  domainPageItems,
  hash,
  isJson,
  keywordData,
  keywordOf,
  pick,
  rankedKeywordItems,
  referringDomainItems,
  serpResult,
  textOf,
  type Json,
} from "@/server/lib/dataforseo/sample-generators";
import { aiOrLocalSampleResult } from "@/server/lib/dataforseo/sample-ai-local";
import {
  dataforseoSampleReason,
  type SampleReason,
} from "@/server/lib/dataforseo/sample-scope";

/**
 * True when data produced now may be sample data and so must not be stored: a
 * call in this scope answered with sample data, or there is no key at all.
 */
export async function inDataforseoSampleMode(): Promise<boolean> {
  if (dataforseoSampleReason() !== null) return true;
  return (await readDataforseoKey()) === null;
}

const SAMPLE_NOTICE =
  "Sample data: DataForSEO is answering with sample data, so any search volume, CPC, keyword difficulty, ranking, SERP, backlink, AI mention or local business figure in this result is made up. Say so when you use one, and never store it as real.";

/**
 * The notice an agent's tool result carries while data produced now may be
 * sample data (outside a request scope: no key), or null.
 */
export async function dataforseoSampleNotice(): Promise<string | null> {
  return (await inDataforseoSampleMode()) ? SAMPLE_NOTICE : null;
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
export function sampleRankPosition(
  keyword: string,
  device: string,
): number | null {
  const n = pick(keyword.trim().toLowerCase(), `rank:${device}`, 0, 34);
  return n > 30 ? null : n + 1;
}

/** DataForSEO HTTP or task status codes that mean "use sample data" rather than "fail the screen". */
export function sampleReasonFor(
  httpStatus: number,
  taskCode?: number,
): SampleReason | null {
  if (
    httpStatus === 401 ||
    taskCode === 40100 ||
    taskCode === 40101 ||
    taskCode === 40104
  )
    return "auth";
  if (httpStatus === 402 || taskCode === 40200 || taskCode === 40210)
    return "credits";
  if (taskCode === 40202 || taskCode === 40209) return "quota";
  return null;
}

/** The result array for one endpoint path (the part after /v3/). */
function resultFor(path: string, task: Json): unknown[] {
  const aiOrLocal = aiOrLocalSampleResult(path, task);
  if (aiOrLocal) return aiOrLocal;
  const kw = keywordOf(task);
  const target = (textOf(task.target) ?? kw)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (/keyword_suggestions\/live|keyword_ideas\/live/.test(path)) {
    const items = [kw, ...sampleKeywordIdeas(kw, 12).map((k) => k.keyword)].map(
      (k) => keywordData(k, task),
    );
    return [
      {
        seed_keyword: kw,
        total_count: items.length,
        items_count: items.length,
        items,
      },
    ];
  }
  if (/related_keywords\/live/.test(path)) {
    const items = sampleKeywordIdeas(kw, 12).map((k) => ({
      se_type: "google",
      keyword_data: keywordData(k.keyword, task),
      depth: 1,
      related_keywords: [],
    }));
    return [
      {
        seed_keyword: kw,
        total_count: items.length,
        items_count: items.length,
        items,
      },
    ];
  }
  if (/keyword_overview\/live/.test(path)) {
    const words = Array.isArray(task.keywords)
      ? task.keywords.map(String)
      : [kw];
    return [
      {
        items: words.map((k) => keywordData(k.toLowerCase(), task)),
        items_count: words.length,
      },
    ];
  }
  if (/google_ads\/(search_volume|keywords_for_keywords)\/live/.test(path)) {
    const words = Array.isArray(task.keywords)
      ? task.keywords.map(String)
      : [kw];
    const list = /keywords_for_keywords/.test(path)
      ? [
          ...words,
          ...sampleKeywordIdeas(words[0] ?? kw, 10).map((k) => k.keyword),
        ]
      : words;
    return list.map((k) => {
      const d = keywordData(k.toLowerCase(), task);
      const info = d.keyword_info;
      return {
        keyword: d.keyword,
        location_code: d.location_code,
        language_code: d.language_code,
        search_volume: info.search_volume,
        cpc: info.cpc,
        competition: info.competition_level,
        competition_index: Math.round(Number(info.competition) * 100),
        low_top_of_page_bid: info.low_top_of_page_bid,
        high_top_of_page_bid: info.high_top_of_page_bid,
        monthly_searches: info.monthly_searches,
      };
    });
  }
  if (/domain_rank_overview\/live/.test(path))
    return [
      {
        target,
        total_count: 1,
        items_count: 1,
        items: [domainRankOverview(target)],
      },
    ];
  if (/ranked_keywords\/live/.test(path)) {
    const items = rankedKeywordItems(target, task);
    return [
      { target, total_count: items.length, items_count: items.length, items },
    ];
  }
  if (/relevant_pages\/live/.test(path)) {
    const items = Array.from({ length: 8 }, (_, i) => ({
      page_address: `https://${target}/sample-page-${i + 1}`,
      metrics: {
        organic: {
          count: pick(`${target}${i}`, "rpc", 3, 200),
          etv: pick(`${target}${i}`, "rpe", 10, 4000),
          pos_1: pick(`${target}${i}`, "rp1", 0, 10),
        },
      },
    }));
    return [
      { target, total_count: items.length, items_count: items.length, items },
    ];
  }
  if (/serp_competitors\/live/.test(path)) {
    const items = competitorItems(kw);
    return [{ total_count: items.length, items_count: items.length, items }];
  }
  if (/serp\/google\/organic\/(live\/advanced|task_get\/advanced)/.test(path))
    return [serpResult(kw, task)];
  if (/backlinks\/summary\/live/.test(path)) return [backlinksSummary(target)];
  if (/backlinks\/backlinks\/live/.test(path)) {
    const items = backlinkItems(target);
    return [
      { target, total_count: items.length, items_count: items.length, items },
    ];
  }
  if (/backlinks\/referring_domains\/live/.test(path)) {
    const items = referringDomainItems(target);
    return [
      { target, total_count: items.length, items_count: items.length, items },
    ];
  }
  if (/backlinks\/domain_pages_summary\/live/.test(path)) {
    const items = domainPageItems(target);
    return [
      { target, total_count: items.length, items_count: items.length, items },
    ];
  }
  if (/backlinks\/history\/live/.test(path)) {
    const items = backlinkHistory(target);
    return [
      { target, total_count: items.length, items_count: items.length, items },
    ];
  }
  if (/locations/.test(path)) {
    return [
      {
        location_code: 2124,
        location_name: "Canada",
        location_code_parent: null,
        country_iso_code: "CA",
        location_type: "Country",
      },
      {
        location_code: 2840,
        location_name: "United States",
        location_code_parent: null,
        country_iso_code: "US",
        location_type: "Country",
      },
    ];
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
  // DataForSEO accepts a queued task with 20100 "Task Created." and no result
  // yet; the queued rank check reads any other status as a rejection. Only the
  // rank check is queued: a sample reviews or business updates post must not
  // succeed, or a later collection would report a real profile as empty.
  const queued = rel === "serp/google/organic/task_post";
  const tasks = (
    Array.isArray(requestBody) && requestBody.length > 0 ? requestBody : [{}]
  ).map((t, i) => {
    const task: Json = isJson(t) ? t : {};
    const result = queued ? null : resultFor(rel, task);
    return {
      id: `sample-${hash(`${rel}${i}${JSON.stringify(task)}`).toString(16)}`,
      status_code: queued ? 20100 : 20000,
      status_message: queued ? "Task Created." : "Ok.",
      time: "0 sec.",
      cost: 0,
      result_count: result?.length ?? 0,
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
