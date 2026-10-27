/**
 * Content score: a 0-100 measure of how well a draft covers its target keyword against a reference, with an
 * itemized list of what to change.
 *
 * Every point traces to a check below; nothing is estimated by a model. A check that cannot be measured (no
 * reference pages, too little text for readability, schema unknown) is marked not_measured and left out of both
 * sides of the ratio, so a missing input never reads as a failing draft. The score is guidance for the writer and
 * never an approval gate.
 */
import { parseMarkdownDraft, type DraftInput, type ParsedDoc } from "./document";
import { looksLikeFaq, termTarget, type ContentReference } from "./reference";
import { containsPhrase, fleschReadingEase, phraseCount, sentences, slugify, words } from "./text";

export const CONTENT_SCORE_METHOD = "lunar_content_score_v1" as const;

/** Length targets used only when there is no reference to take them from. */
export const DEFAULT_TARGETS = {
  word_count: { target_min: 800, target_max: 2000 },
  subheadings: { target_min: 4, target_max: 12 },
} as const;

export type CheckStatus = "pass" | "warn" | "fail" | "not_measured";

export interface ScoreItem {
  id: string;
  label: string;
  points: number;
  max: number;
  status: CheckStatus;
  detail: string;
}

export interface ScoreComponent {
  id: "coverage" | "placement" | "structure" | "readability" | "links" | "images" | "answers";
  label: string;
  points: number;
  max: number;
  items: ScoreItem[];
}

export interface Guidance {
  id: string;
  severity: "fix" | "improve" | "info";
  message: string;
}

export interface TermStatus {
  term: string;
  count: number;
  target_min: number;
  target_max: number;
  status: "missing" | "under" | "ok" | "over";
}

export interface ContentScore {
  method: typeof CONTENT_SCORE_METHOD;
  keyword: string;
  score: number;
  band: "low" | "fair" | "good" | "strong";
  components: ScoreComponent[];
  guidance: Guidance[];
  terms: TermStatus[];
  measured: {
    word_count: number;
    subheadings: number;
    flesch: number | null;
    keyword_uses: number;
    keyword_density: number;
    internal_links: number;
    external_links: number;
    images: number;
    images_missing_alt: number;
  };
  limitations: string[];
}

export interface ScoreOptions {
  /** The site's own host (for example "example.com"), so links to it count as internal. */
  site_host?: string;
}

function item(id: string, label: string, max: number, points: number, status: CheckStatus, detail: string): ScoreItem {
  return { id, label, max, points: Math.round(Math.max(0, Math.min(max, points)) * 10) / 10, status, detail };
}

function component(id: ScoreComponent["id"], label: string, items: ScoreItem[]): ScoreComponent {
  const measured = items.filter((i) => i.status !== "not_measured");
  return {
    id,
    label,
    items,
    points: Math.round(measured.reduce((s, i) => s + i.points, 0) * 10) / 10,
    max: measured.reduce((s, i) => s + i.max, 0),
  };
}

function hostOf(href: string): string | null {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function linkKinds(doc: ParsedDoc, siteHost?: string): { internal: number; external: number } {
  const own = siteHost?.toLowerCase().replace(/^www\./, "");
  let internal = 0;
  let external = 0;
  for (const link of doc.links) {
    const href = link.href.trim();
    if (!href || href.startsWith("#") || /^(mailto|tel):/i.test(href)) continue;
    if (href.startsWith("/") && !href.startsWith("//")) { internal += 1; continue; }
    const host = hostOf(href.startsWith("//") ? `https:${href}` : href);
    if (!host) { internal += 1; continue; } // a relative path
    if (own && (host === own || host.endsWith(`.${own}`))) internal += 1;
    else external += 1;
  }
  return { internal, external };
}

/** Body text without heading lines, so "keyword early" means the opening prose, not the H1. */
function openingProse(doc: ParsedDoc, n = 100): string {
  const headingText = new Set(doc.headings.map((h) => h.text));
  return doc.text.split("\n").filter((line) => !headingText.has(line)).join(" ").split(/\s+/).slice(0, n).join(" ");
}

function bandOf(score: number): ContentScore["band"] {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 45) return "fair";
  return "low";
}

function lengthCredit(value: number, min: number, max: number): number {
  if (value >= min && value <= max) return 1;
  if (value < min) return Math.max(0, value / Math.max(min, 1));
  return value <= max * 1.5 ? 0.85 : 0.6;
}

export function scoreContent(draft: DraftInput, keywordRaw: string, reference: ContentReference | null, options: ScoreOptions = {}): ContentScore {
  const keyword = keywordRaw.trim().toLowerCase();
  const doc = parseMarkdownDraft(draft);
  const guidance: Guidance[] = [];
  const limitations: string[] = [...(reference?.limitations ?? [])];
  const keywordWordCount = Math.max(1, words(keyword).length);

  // --- Term coverage --------------------------------------------------------------------------------------------
  const terms: TermStatus[] = [];
  const coverageItems: ScoreItem[] = [];
  if (reference && reference.terms.length > 0) {
    let weightSum = 0;
    let credit = 0;
    for (const t of reference.terms) {
      const target = termTarget(t, doc.word_count);
      const count = phraseCount(doc.text, t.term);
      const status: TermStatus["status"] = count === 0 ? "missing" : count < target.min ? "under" : count > target.max * 1.5 ? "over" : "ok";
      terms.push({ term: t.term, count, target_min: target.min, target_max: target.max, status });
      weightSum += t.weight;
      credit += t.weight * (status === "over" ? 0.8 : Math.min(1, count / target.min));
    }
    const ratio = weightSum > 0 ? credit / weightSum : 0;
    const missing = terms.filter((t) => t.status === "missing");
    coverageItems.push(item("terms", "Related terms used", 30, ratio * 30, ratio >= 0.75 ? "pass" : ratio >= 0.45 ? "warn" : "fail",
      `${terms.length - missing.length} of ${terms.length} reference terms used`));
    if (missing.length > 0) {
      guidance.push({ id: "terms_missing", severity: ratio < 0.45 ? "fix" : "improve", message: `Cover these terms where they fit the topic: ${missing.slice(0, 8).map((t) => t.term).join(", ")}.` });
    }
    const over = terms.filter((t) => t.status === "over");
    if (over.length > 0) guidance.push({ id: "terms_over", severity: "improve", message: `Used more often than the reference pages: ${over.slice(0, 5).map((t) => t.term).join(", ")}.` });
  } else {
    coverageItems.push(item("terms", "Related terms used", 30, 0, "not_measured", "No reference pages to compare against"));
    limitations.push("Term coverage is not measured: add competitor pages or sources, or connect a SERP provider.");
  }

  // --- Keyword placement ----------------------------------------------------------------------------------------
  const h1 = doc.headings.find((h) => h.level === 1)?.text ?? "";
  const slug = draft.slug?.trim() ? slugify(draft.slug) : "";
  const meta = draft.meta_description?.trim() ?? "";
  const keywordSlug = slugify(keyword);
  const keywordUses = phraseCount(doc.text, keyword);
  const density = doc.word_count > 0 ? (keywordUses * keywordWordCount) / doc.word_count : 0;
  const placementItems: ScoreItem[] = [
    item("kw_title", "Keyword in title", 5, containsPhrase(doc.title, keyword) ? 5 : 0, containsPhrase(doc.title, keyword) ? "pass" : "fail", doc.title || "No title"),
    item("kw_h1", "Keyword in H1", 3, containsPhrase(h1, keyword) ? 3 : 0, !h1 ? "fail" : containsPhrase(h1, keyword) ? "pass" : "fail", h1 || "No H1 heading in the body"),
    item("kw_opening", "Keyword in first 100 words", 4, containsPhrase(openingProse(doc), keyword) ? 4 : 0, containsPhrase(openingProse(doc), keyword) ? "pass" : "fail", "Opening paragraph"),
    slug
      ? item("kw_slug", "Keyword in slug", 2, keywordSlug && slug.includes(keywordSlug) ? 2 : 0, keywordSlug && slug.includes(keywordSlug) ? "pass" : "fail", slug)
      : item("kw_slug", "Keyword in slug", 2, 0, "not_measured", "No slug set yet"),
    meta
      ? item("kw_meta", "Keyword in meta description", 3, containsPhrase(meta, keyword) ? 3 : 0, containsPhrase(meta, keyword) ? "pass" : "fail", `${meta.length} characters`)
      : item("kw_meta", "Keyword in meta description", 3, 0, "not_measured", "No meta description set yet"),
  ];
  if (!containsPhrase(doc.title, keyword)) guidance.push({ id: "kw_title", severity: "fix", message: `Put "${keyword}" in the title.` });
  if (!h1) guidance.push({ id: "kw_h1_missing", severity: "fix", message: "Start the article with one H1 heading (# Heading)." });
  else if (!containsPhrase(h1, keyword)) guidance.push({ id: "kw_h1", severity: "improve", message: `Use "${keyword}" in the H1.` });
  if (!containsPhrase(openingProse(doc), keyword)) guidance.push({ id: "kw_opening", severity: "improve", message: `Mention "${keyword}" in the first 100 words.` });
  if (slug && keywordSlug && !slug.includes(keywordSlug)) guidance.push({ id: "kw_slug", severity: "improve", message: `Use "${keywordSlug}" in the slug.` });
  if (meta && !containsPhrase(meta, keyword)) guidance.push({ id: "kw_meta", severity: "improve", message: `Use "${keyword}" in the meta description.` });
  if (meta && (meta.length < 70 || meta.length > 160)) guidance.push({ id: "meta_length", severity: "improve", message: `Meta description is ${meta.length} characters; aim for 70 to 160.` });
  if (doc.title.length > 65) guidance.push({ id: "title_length", severity: "improve", message: `Title is ${doc.title.length} characters; search results usually cut titles near 60.` });
  if (h1 && doc.headings.filter((h) => h.level === 1).length > 1) guidance.push({ id: "h1_multiple", severity: "improve", message: "Use one H1; make the others H2." });
  if (density > 0.03) {
    guidance.push({ id: "kw_stuffing", severity: "fix", message: `"${keyword}" makes up ${(density * 100).toFixed(1)}% of the words; write it naturally (under 3%).` });
    placementItems.push(item("kw_density", "Keyword not overused", 3, 0, "fail", `${(density * 100).toFixed(1)}% of words`));
  } else {
    placementItems.push(item("kw_density", "Keyword not overused", 3, 3, "pass", `${(density * 100).toFixed(1)}% of words`));
  }

  // --- Length and structure -------------------------------------------------------------------------------------
  const wcTarget = reference?.word_count ?? null;
  const shTarget = reference?.subheadings ?? null;
  const wcMin = wcTarget?.target_min ?? DEFAULT_TARGETS.word_count.target_min;
  const wcMax = wcTarget?.target_max ?? DEFAULT_TARGETS.word_count.target_max;
  const shMin = shTarget?.target_min ?? DEFAULT_TARGETS.subheadings.target_min;
  const shMax = shTarget?.target_max ?? DEFAULT_TARGETS.subheadings.target_max;
  const subheadings = doc.headings.filter((h) => h.level === 2 || h.level === 3).length;
  const wcCredit = lengthCredit(doc.word_count, wcMin, wcMax);
  const shCredit = lengthCredit(subheadings, shMin, shMax);
  const structureItems = [
    item("word_count", "Length", 9, wcCredit * 9, wcCredit === 1 ? "pass" : wcCredit >= 0.6 ? "warn" : "fail", `${doc.word_count} words; target ${wcMin} to ${wcMax}`),
    item("subheadings", "Subheadings", 6, shCredit * 6, shCredit === 1 ? "pass" : shCredit >= 0.6 ? "warn" : "fail", `${subheadings} H2/H3; target ${shMin} to ${shMax}`),
  ];
  if (!wcTarget) limitations.push(`Length target is the default ${wcMin} to ${wcMax} words, not measured from ranking pages.`);
  if (doc.word_count < wcMin) guidance.push({ id: "word_count_low", severity: wcCredit < 0.6 ? "fix" : "improve", message: `Add depth: ${doc.word_count} words against a target of ${wcMin} to ${wcMax}.` });
  if (doc.word_count > wcMax * 1.5) guidance.push({ id: "word_count_high", severity: "info", message: `At ${doc.word_count} words this is well past the reference pages (up to ${wcMax}); cut what does not serve the reader.` });
  if (subheadings < shMin) guidance.push({ id: "subheadings_low", severity: "improve", message: `Break the article up: ${subheadings} subheadings against ${shMin} to ${shMax}.` });

  // --- Readability ----------------------------------------------------------------------------------------------
  const flesch = fleschReadingEase(doc.text);
  const longSentences = sentences(doc.text).filter((s) => words(s).length > 25).length;
  const readabilityItems = [
    flesch === null
      ? item("flesch", "Reading ease (Flesch)", 10, 0, "not_measured", "Too little text to measure")
      : item("flesch", "Reading ease (Flesch)", 10, flesch >= 60 ? 10 : flesch >= 50 ? 7 : flesch >= 40 ? 4 : 1, flesch >= 60 ? "pass" : flesch >= 50 ? "warn" : "fail", `${flesch}; 60 or above reads as plain English`),
  ];
  if (flesch !== null && flesch < 50) guidance.push({ id: "readability", severity: "improve", message: `Reading ease is ${flesch}. Shorter sentences and plainer words raise it.` });
  if (longSentences >= 3) guidance.push({ id: "long_sentences", severity: "improve", message: `${longSentences} sentences run past 25 words; split them.` });

  // --- Links ----------------------------------------------------------------------------------------------------
  const { internal, external } = linkKinds(doc, options.site_host);
  const linkItems = [
    item("internal_links", "Internal links", 5, internal >= 2 ? 5 : internal === 1 ? 3 : 0, internal >= 2 ? "pass" : internal === 1 ? "warn" : "fail", `${internal} to your own site`),
    item("external_links", "Sources linked", 5, external >= 1 ? 5 : 0, external >= 1 ? "pass" : "fail", `${external} to other sites`),
  ];
  if (internal < 2) guidance.push({ id: "internal_links", severity: "improve", message: "Link to at least two related pages on your own site." });
  if (external < 1) guidance.push({ id: "external_links", severity: "improve", message: "Link to at least one authoritative source that backs a claim." });
  if (!options.site_host) limitations.push("Site address unknown: only relative links count as internal.");

  // --- Images ---------------------------------------------------------------------------------------------------
  const missingAlt = doc.images.filter((i) => !i.alt).length;
  const imageItems = [
    doc.images.length === 0
      ? item("images", "Images with alt text", 5, 2, "warn", "No images in the text")
      : item("images", "Images with alt text", 5, 5 * ((doc.images.length - missingAlt) / doc.images.length), missingAlt === 0 ? "pass" : "fail", `${doc.images.length - missingAlt} of ${doc.images.length} have alt text`),
  ];
  if (doc.images.length === 0) guidance.push({ id: "images_none", severity: "info", message: "Add an image that explains something, with alt text that describes it." });
  if (missingAlt > 0) guidance.push({ id: "images_alt", severity: "fix", message: `${missingAlt} image${missingAlt === 1 ? " has" : "s have"} no alt text.` });

  // --- Answers (AEO): FAQ and structured data -------------------------------------------------------------------
  const hasFaq = looksLikeFaq(doc);
  const schemaKnown = draft.schema_types !== undefined;
  const answerItems = [
    item("faq", "Questions answered (FAQ)", 5, hasFaq ? 5 : 0, hasFaq ? "pass" : reference && reference.faq_share >= 0.5 ? "fail" : "warn", hasFaq ? "Question headings found" : "No question headings"),
    schemaKnown
      ? item("schema", "Structured data", 5, doc.schema_types.length > 0 ? 5 : 0, doc.schema_types.length > 0 ? "pass" : "fail", doc.schema_types.join(", ") || "None declared")
      : item("schema", "Structured data", 5, 0, "not_measured", "Schema is set when the article is published"),
  ];
  if (!hasFaq) {
    const share = reference ? Math.round(reference.faq_share * 100) : null;
    guidance.push({ id: "faq", severity: share !== null && share >= 50 ? "improve" : "info", message: share !== null && share > 0 ? `${share}% of reference pages answer questions under their own headings; add a short FAQ.` : "Answer two or three real reader questions under question headings." });
  }
  if (schemaKnown && hasFaq && !doc.schema_types.includes("FAQPage")) guidance.push({ id: "schema_faq", severity: "improve", message: "The article has an FAQ; publish it with FAQPage structured data." });
  if (schemaKnown && doc.schema_types.length === 0) guidance.push({ id: "schema_none", severity: "improve", message: "Publish with Article structured data (and FAQPage when there is an FAQ)." });

  const components = [
    component("coverage", "Topic coverage", coverageItems),
    component("placement", "Keyword placement", placementItems),
    component("structure", "Length and structure", structureItems),
    component("readability", "Readability", readabilityItems),
    component("links", "Links", linkItems),
    component("images", "Images", imageItems),
    component("answers", "Answers and schema", answerItems),
  ];
  const max = components.reduce((s, c) => s + c.max, 0);
  const points = components.reduce((s, c) => s + c.points, 0);
  const score = max > 0 ? Math.round((points / max) * 100) : 0;
  limitations.push("Readability and term matching use English rules.");

  const order = { fix: 0, improve: 1, info: 2 } as const;
  guidance.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    method: CONTENT_SCORE_METHOD,
    keyword,
    score,
    band: bandOf(score),
    components,
    guidance,
    terms,
    measured: {
      word_count: doc.word_count,
      subheadings,
      flesch,
      keyword_uses: keywordUses,
      keyword_density: Math.round(density * 10000) / 10000,
      internal_links: internal,
      external_links: external,
      images: doc.images.length,
      images_missing_alt: missingAlt,
    },
    limitations: [...new Set(limitations)],
  };
}
