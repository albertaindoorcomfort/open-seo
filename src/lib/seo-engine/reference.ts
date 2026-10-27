/**
 * The reference a draft is scored against, built from the pages that rank for (or were chosen to represent) the
 * target keyword.
 *
 * Method, in plain terms: count every content n-gram (1-3 words) on each page; keep the terms that appear on a
 * real share of the pages; rank them by that share times a TF-IDF style weight (frequency per 1000 words, damped
 * with a log, and an inverse-document-frequency boost for terms concentrated on fewer pages); and keep the median
 * density so a target can be scaled to the draft's own length. Word count and heading count targets are the
 * pages' interquartile range.
 *
 * A page is reduced to a compact profile (counts only, no full text) as soon as it is measured, so the reference
 * is small enough to hand to the browser for live re-scoring and holds no third-party prose.
 */
import type { ParsedDoc } from "./document";
import { phraseCount, termCounts, words } from "./text";

export const REFERENCE_LIMITS = {
  maxPages: 10,
  termsPerPage: 250,
  maxTerms: 40,
} as const;

export interface ReferencePage {
  url: string;
  title: string;
  word_count: number;
  /** H2 and H3 headings: the outline a reader scans. */
  subheading_count: number;
  /** Count of each kept n-gram on this page. */
  terms: Record<string, number>;
  schema_types: string[];
  has_faq: boolean;
  /** How the page was obtained: ranked in a SERP, chosen by the person, or a source already on the article. */
  origin: "serp" | "provided" | "source";
}

export interface ReferenceTerm {
  term: string;
  /** Pages using the term, and that as a share of all pages. */
  pages: number;
  share: number;
  /** Median uses per 1000 words across the pages that use it. */
  density_per_1000: number;
  weight: number;
}

export interface Range {
  min: number;
  median: number;
  max: number;
  target_min: number;
  target_max: number;
}

export interface ContentReference {
  keyword: string;
  pages: Array<Pick<ReferencePage, "url" | "title" | "word_count" | "subheading_count" | "origin">>;
  terms: ReferenceTerm[];
  word_count: Range | null;
  subheadings: Range | null;
  faq_share: number;
  schema_types: string[];
  limitations: string[];
}

const QUESTION_START = /^(how|what|why|when|where|which|who|can|do|does|is|are|should|will)\b/i;

export function looksLikeFaq(doc: Pick<ParsedDoc, "headings" | "schema_types">): boolean {
  if (doc.schema_types.some((t) => t === "FAQPage" || t === "QAPage")) return true;
  if (doc.headings.some((h) => /\b(faq|frequently asked)\b/i.test(h.text))) return true;
  return doc.headings.filter((h) => h.level >= 2 && (h.text.endsWith("?") || QUESTION_START.test(h.text))).length >= 2;
}

/** Reduce one measured page to its profile. */
export function profilePage(url: string, doc: ParsedDoc, origin: ReferencePage["origin"]): ReferencePage {
  const counts = [...termCounts(doc.text).entries()]
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, REFERENCE_LIMITS.termsPerPage);
  return {
    url,
    title: doc.title.slice(0, 240),
    word_count: doc.word_count,
    subheading_count: doc.headings.filter((h) => h.level === 2 || h.level === 3).length,
    terms: Object.fromEntries(counts),
    schema_types: doc.schema_types.slice(0, 12),
    has_faq: looksLikeFaq(doc),
    origin,
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function rangeOf(values: number[], stretch = 1.1): Range | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    min: sorted[0],
    median: Math.round(quantile(sorted, 0.5)),
    max: sorted[sorted.length - 1],
    target_min: Math.round(quantile(sorted, 0.25)),
    target_max: Math.max(Math.round(quantile(sorted, 0.75) * stretch), Math.round(quantile(sorted, 0.25)) + 1),
  };
}

/** Terms that only restate the keyword are checked by placement, not coverage. */
function restatesKeyword(term: string, keywordWords: Set<string>): boolean {
  const ws = words(term);
  return ws.length > 0 && ws.every((w) => keywordWords.has(w));
}

export function buildReference(keyword: string, input: ReferencePage[]): ContentReference {
  const pages = input.filter((p) => p.word_count >= 50).slice(0, REFERENCE_LIMITS.maxPages);
  const limitations: string[] = [];
  if (pages.length < input.length) limitations.push("Pages under 50 words, or past the first ten, were left out of the reference.");
  if (pages.length === 0) {
    return { keyword, pages: [], terms: [], word_count: null, subheadings: null, faq_share: 0, schema_types: [], limitations: [...limitations, "No reference pages: term coverage and length targets are not measured."] };
  }
  if (pages.length < 3) limitations.push(`Built from ${pages.length} page${pages.length === 1 ? "" : "s"}; three or more give steadier targets.`);
  limitations.push("Term targets are counted from the reference pages' own text (English heuristics); they are guidance, not a ranking guarantee.");

  const keywordWords = new Set(words(keyword));
  const minPages = pages.length >= 3 ? Math.max(2, Math.ceil(pages.length * 0.3)) : 1;
  const usage = new Map<string, number[]>();
  for (const page of pages) {
    const per1000 = 1000 / Math.max(page.word_count, 1);
    for (const [term, count] of Object.entries(page.terms)) {
      if (restatesKeyword(term, keywordWords)) continue;
      const list = usage.get(term) ?? [];
      list.push(count * per1000);
      usage.set(term, list);
    }
  }

  const n = pages.length;
  const candidates: ReferenceTerm[] = [];
  for (const [term, densities] of usage) {
    if (densities.length < minPages) continue;
    const sorted = [...densities].sort((a, b) => a - b);
    const density = quantile(sorted, 0.5);
    const share = densities.length / n;
    // TF (log-damped density) x IDF-style concentration, scaled by how many pages agree.
    const idf = Math.log(1 + n / densities.length);
    const gramBonus = 1 + 0.15 * (words(term).length - 1);
    candidates.push({
      term,
      pages: densities.length,
      share: Math.round(share * 100) / 100,
      density_per_1000: Math.round(density * 100) / 100,
      weight: Math.round(share * Math.log(1 + density) * (1 + idf) * gramBonus * 1000) / 1000,
    });
  }
  candidates.sort((a, b) => b.share - a.share || b.weight - a.weight || a.term.localeCompare(b.term));

  // A term that (almost) only ever appears inside a longer kept phrase, or a phrase that (almost) always appears with
  // a kept part, is the same term twice; keep one. "Almost" = within 25% of the same density.
  const kept: ReferenceTerm[] = [];
  const sameTerm = (a: ReferenceTerm, b: ReferenceTerm) => {
    const [short, long] = a.term.length < b.term.length ? [a, b] : [b, a];
    return ` ${long.term} `.includes(` ${short.term} `) && long.density_per_1000 >= short.density_per_1000 * 0.75;
  };
  for (const c of candidates) {
    if (kept.length >= REFERENCE_LIMITS.maxTerms) break;
    const twin = kept.findIndex((k) => sameTerm(k, c));
    if (twin === -1) { kept.push(c); continue; }
    // Of two twins keep the two-word phrase: specific enough to mean something, short enough to place naturally.
    const k = kept[twin];
    const score = (t: ReferenceTerm) => { const n = words(t.term).length; return n === 2 ? 2 : n === 3 ? 1 : 0; };
    if (score(c) > score(k)) kept[twin] = c;
  }

  const schema = new Map<string, number>();
  for (const p of pages) for (const t of new Set(p.schema_types)) schema.set(t, (schema.get(t) ?? 0) + 1);

  return {
    keyword,
    pages: pages.map(({ url, title, word_count, subheading_count, origin }) => ({ url, title, word_count, subheading_count, origin })),
    terms: kept,
    word_count: rangeOf(pages.map((p) => p.word_count)),
    subheadings: rangeOf(pages.map((p) => p.subheading_count), 1.2),
    faq_share: Math.round((pages.filter((p) => p.has_faq).length / n) * 100) / 100,
    schema_types: [...schema.entries()].filter(([, c]) => c >= Math.max(1, Math.ceil(n * 0.3))).map(([t]) => t).sort(),
    limitations,
  };
}

/** Target use range for one term, scaled from the reference density to the draft's length. */
export function termTarget(term: ReferenceTerm, draftWords: number): { min: number; max: number } {
  const expected = (term.density_per_1000 * Math.max(draftWords, 300)) / 1000;
  const min = Math.max(1, Math.round(expected * 0.5));
  return { min, max: Math.max(min + 1, Math.round(expected * 1.6)) };
}

export function countTerm(text: string, term: string): number {
  return phraseCount(text, term);
}
