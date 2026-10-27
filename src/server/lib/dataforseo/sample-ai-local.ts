// Lunar Optimize sample data for the AI visibility pages (Brand Lookup, Prompt
// Explorer) and the local business tools. Without these branches sample mode
// answered them with empty results; now they answer with labelled samples:
// every question, answer and business says "Sample" outright and every cited
// source or website sits on the reserved .example TLD, so no row can pass for
// what a model said or what Google lists.

import {
  isJson,
  pick,
  textOf,
  type Json,
} from "@/server/lib/dataforseo/sample-generators";

/** The brand or domain a mentions request is about (its first target element). */
function mentionTargetOf(task: Json): string {
  const first: unknown = Array.isArray(task.target)
    ? task.target[0]
    : undefined;
  const name = isJson(first)
    ? (textOf(first.domain) ?? textOf(first.keyword))
    : undefined;
  return (name ?? "sample brand").trim().toLowerCase();
}

function sourceUrl(target: string, i: number): string {
  // A domain target is cited by its own (sample) pages; a brand keyword by
  // sample third-party pages.
  return target.includes(".")
    ? `https://${target}/sample-page-${i + 1}`
    : `https://sample-source-${i + 1}.example/`;
}

function platformGroup(seed: string, platform: string): Json {
  return {
    type: "group_element",
    key: platform,
    mentions: pick(seed, "llm-mentions", 3, 400),
    ai_search_volume: pick(seed, "llm-volume", 50, 9000),
    impressions: pick(seed, "llm-impressions", 100, 40_000),
  };
}

function mentionItems(target: string): Json[] {
  return Array.from({ length: 8 }, (_, i) => ({
    question: `Sample question ${i + 1} about ${target}`,
    sources: [
      {
        url: sourceUrl(target, i % 4),
        title: `Sample source ${(i % 4) + 1}`,
        domain: new URL(sourceUrl(target, i % 4)).hostname,
      },
    ],
    ai_search_volume: pick(`${target}${i}`, "llm-question", 10, 900),
    monthly_searches: [],
    brand_entities: [],
  }));
}

function crossAggregatedItems(task: Json, platform: string): Json[] {
  const groups = Array.isArray(task.targets) ? task.targets : [];
  return groups.map((group: unknown, i) => {
    const key =
      (isJson(group) ? textOf(group.aggregation_key) : undefined) ??
      `Sample brand ${i + 1}`;
    return { key, platform: [platformGroup(key, platform)] };
  });
}

function llmResponse(task: Json): Json {
  const prompt = textOf(task.user_prompt) ?? "this prompt";
  return {
    model_name: textOf(task.model_name) ?? "sample",
    output_tokens: 0,
    web_search: task.web_search !== false,
    items: [
      {
        type: "message",
        sections: [
          {
            type: "text",
            text: `Sample answer, not a model response. A live answer to "${prompt}" appears here once DataForSEO is connected.`,
            annotations: [
              {
                type: "url_citation",
                title: "Sample source 1",
                url: "https://sample-source-1.example/",
              },
            ],
          },
        ],
      },
    ],
    fan_out_queries: [],
  };
}

function businessItem(seed: string, i: number): Json {
  const domain = `sample-business-${i + 1}.example`;
  return {
    type: "business_listing",
    title: `Sample business ${i + 1}`,
    category: "Sample category",
    address: `${i + 1} Sample Street`,
    domain,
    url: `https://${domain}/`,
    is_claimed: i % 2 === 0,
    rating: {
      rating_type: "Max5",
      value: pick(`${seed}${i}`, "biz-rating", 30, 50) / 10,
      votes_count: pick(`${seed}${i}`, "biz-votes", 3, 400),
    },
  };
}

/**
 * The sample result array for an AI visibility or local business endpoint
 * (path after /v3/), or null when the path is neither.
 */
export function aiOrLocalSampleResult(
  path: string,
  task: Json,
): unknown[] | null {
  const platform = textOf(task.platform) ?? "google";
  if (/ai_optimization\/llm_mentions\/search\/live/.test(path)) {
    const items = mentionItems(mentionTargetOf(task));
    return [{ total_count: items.length, items_count: items.length, items }];
  }
  if (/ai_optimization\/llm_mentions\/aggregated_metrics\/live/.test(path))
    return [
      {
        total: {
          platform: [platformGroup(mentionTargetOf(task), platform)],
        },
      },
    ];
  if (/ai_optimization\/llm_mentions\/top_pages\/live/.test(path)) {
    const target = mentionTargetOf(task);
    const items = Array.from({ length: 5 }, (_, i) => ({
      key: sourceUrl(target, i),
      platform: [platformGroup(`${target}${i}`, platform)],
    }));
    return [{ total_count: items.length, items_count: items.length, items }];
  }
  if (
    /ai_optimization\/llm_mentions\/cross_aggregated_metrics\/live/.test(path)
  )
    return [{ items: crossAggregatedItems(task, platform) }];
  if (/ai_optimization\/[a-z_]+\/llm_responses\/live/.test(path))
    return [llmResponse(task)];
  const seed = textOf(task.keyword) ?? textOf(task.title) ?? "sample";
  if (/business_data\/business_listings\/search\/live/.test(path)) {
    const items = Array.from({ length: 6 }, (_, i) => businessItem(seed, i));
    return [{ total_count: items.length, items_count: items.length, items }];
  }
  if (/business_data\/google\/my_business_info\/live/.test(path))
    return [
      {
        keyword: seed,
        check_url: "https://sample-maps.example/",
        items: [{ ...businessItem(seed, 0), type: "google_business_info" }],
      },
    ];
  return null;
}
