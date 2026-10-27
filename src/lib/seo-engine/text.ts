/**
 * Text primitives for the SEO engine: words, sentences, n-grams and the Flesch reading-ease formula.
 *
 * Pure and framework-free (no Next, no app aliases), so the scorer runs the same in the browser, on the server and
 * in another product. English only: the stopword list and syllable counter are English heuristics, and a score for
 * another language says so in its limitations.
 */

// Function words that carry no topic. Kept short on purpose: a long list starts removing real terms.
const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are as at be because been before being below between both but by " +
    "can could did do does doing down during each few for from further had has have having he her here hers herself him " +
    "himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other " +
    "our ours ourselves out over own same she should so some such than that the their theirs them themselves then there " +
    "these they this those through to too under until up very was we were what when where which while who whom why will " +
    "with would you your yours yourself yourselves also may might must shall us via vs per yet"
  ).split(" "),
);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word);
}

/** Lower-case word tokens. Apostrophes inside a word are kept ("don't"), digits count as words. */
export function words(text: string): string[] {
  return (text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).map((w) => w.replace(/’/g, "'"));
}

export function wordCount(text: string): number {
  return words(text).length;
}

/** Sentences split on terminal punctuation or line breaks; empty pieces dropped. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0);
}

/** English syllable estimate: vowel groups, minus a silent final e, at least one per word. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/**
 * Flesch reading ease: 206.835 - 1.015 (words / sentences) - 84.6 (syllables / words). Higher is easier; 60-70 is
 * plain English. Returns null for text too short to measure honestly.
 */
export function fleschReadingEase(text: string): number | null {
  const ws = words(text);
  const ss = sentences(text);
  if (ws.length < 30 || ss.length === 0) return null;
  const syl = ws.reduce((sum, w) => sum + syllables(w), 0);
  const score = 206.835 - 1.015 * (ws.length / ss.length) - 84.6 * (syl / ws.length);
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

// A three-word term may bridge two content words only with one of these ("cost of installation").
const BRIDGES = new Set(["of", "for", "in", "to", "on", "with"]);

/**
 * Content n-grams of length 1..maxN, built inside one clause at a time so no term spans a sentence, comma or line
 * break. A gram may not start or end with a stopword ("of the" is not a term, "cost of installation" is), a
 * three-word gram may only bridge with a preposition, and single-character or numeric-only unigrams are skipped.
 */
export function ngrams(text: string, maxN = 3): string[] {
  const out: string[] = [];
  for (const clause of text.split(/[.!?;:,()[\]"\n–—]+/)) {
    const ws = words(clause);
    for (let n = 1; n <= maxN; n += 1) {
      for (let i = 0; i + n <= ws.length; i += 1) {
        const first = ws[i];
        const last = ws[i + n - 1];
        if (isStopword(first) || isStopword(last)) continue;
        if (n === 1 && (first.length < 3 || /^\d+$/.test(first))) continue;
        if (n === 3 && isStopword(ws[i + 1]) && !BRIDGES.has(ws[i + 1])) continue;
        out.push(ws.slice(i, i + n).join(" "));
      }
    }
  }
  return out;
}

export function termCounts(text: string, maxN = 3): Map<string, number> {
  const counts = new Map<string, number>();
  for (const gram of ngrams(text, maxN)) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  return counts;
}

/** Occurrences of a phrase as whole words (case-insensitive). */
export function phraseCount(text: string, phrase: string): number {
  const target = words(phrase);
  if (target.length === 0) return 0;
  const ws = words(text);
  let count = 0;
  for (let i = 0; i + target.length <= ws.length; i += 1) {
    let match = true;
    for (let j = 0; j < target.length; j += 1) {
      if (ws[i + j] !== target[j]) { match = false; break; }
    }
    if (match) count += 1;
  }
  return count;
}

export function containsPhrase(text: string, phrase: string): boolean {
  return phraseCount(text, phrase) > 0;
}

export function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
