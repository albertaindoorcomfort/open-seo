/**
 * Turn the two inputs the scorer compares into one shape: a draft (Markdown, as the article workspace stores it) and
 * a reference page (HTML fetched by the caller, or plain text a person supplied).
 *
 * Reference pages are untrusted third-party text. This module only measures them: nothing in a page is followed,
 * executed or treated as an instruction, and only counts and short terms leave it.
 */
import { wordCount } from "./text";

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface DocLink {
  href: string;
  text: string;
}

export interface DocImage {
  src: string;
  alt: string;
}

/** A measured document: either the draft under edit or one reference page. */
export interface ParsedDoc {
  title: string;
  headings: Heading[];
  /** Readable body text, one block per line, without Markdown or HTML syntax. */
  text: string;
  links: DocLink[];
  images: DocImage[];
  word_count: number;
  /** Schema.org types declared in JSON-LD blocks (reference pages only; a Markdown draft has none). */
  schema_types: string[];
}

export interface DraftInput {
  title: string;
  meta_description?: string;
  slug?: string;
  /** Article body as Markdown. */
  body: string;
  /** Schema.org types the article will be published with, when the workspace knows them. */
  schema_types?: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(/<[^>]+>/g, " ");
}

/** Parse a Markdown draft. The H1 is the first `# ` heading; the workspace title stands in when there is none. */
export function parseMarkdownDraft(draft: DraftInput): ParsedDoc {
  const headings: Heading[] = [];
  const links: DocLink[] = [];
  const images: DocImage[] = [];
  const lines: string[] = [];
  let inFence = false;

  for (const raw of draft.body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;

    for (const m of raw.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) images.push({ alt: clean(m[1]), src: m[2] });
    for (const m of raw.matchAll(/(?<!!)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) links.push({ text: clean(stripInlineMarkdown(m[1])), href: m[2] });
    for (const m of raw.matchAll(/<img\b[^>]*>/gi)) {
      const src = m[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
      const alt = m[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
      images.push({ src, alt: clean(alt) });
    }

    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const text = clean(stripInlineMarkdown(heading[2]));
      headings.push({ level: heading[1].length as Heading["level"], text });
      lines.push(text);
      continue;
    }
    const line = clean(stripInlineMarkdown(raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s*>\s?/, "")));
    if (line && !/^[-*_]{3,}$/.test(line) && !/^\|?[\s:|-]+\|?$/.test(line)) lines.push(line.replace(/\|/g, " "));
  }

  const text = lines.join("\n");
  return {
    title: clean(draft.title),
    headings,
    text,
    links,
    images,
    word_count: wordCount(text),
    schema_types: [...new Set((draft.schema_types ?? []).map((t) => t.trim()).filter(Boolean))],
  };
}

function schemaTypesFromJsonLd(html: string): string[] {
  const types = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    // Only the "@type" values are read; the rest of the block is ignored.
    for (const t of m[1].matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
      for (const name of t[1].matchAll(/"([^"]+)"/g)) if (name[1].length <= 60) types.add(name[1]);
    }
  }
  return [...types];
}

/** Parse a fetched HTML page: the main or article element when present, chrome (nav, header, footer, forms) removed. */
export function parseHtmlPage(html: string): ParsedDoc {
  const title = clean(decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
  const schema_types = schemaTypesFromJsonLd(html);
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  const body = main
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|title|script|style|noscript|svg|template|iframe|nav|header|footer|form)\b[\s\S]*?<\/\1>/gi, " ");

  const headings: Heading[] = [];
  for (const m of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = clean(decodeEntities(m[2].replace(/<[^>]+>/g, " ")));
    if (text) headings.push({ level: Number(m[1]) as Heading["level"], text });
  }
  const links: DocLink[] = [];
  for (const m of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    links.push({ href: m[1], text: clean(decodeEntities(m[2].replace(/<[^>]+>/g, " "))) });
  }
  const images: DocImage[] = [];
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    images.push({
      src: m[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? "",
      alt: clean(decodeEntities(m[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "")),
    });
  }
  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map(clean)
    .filter(Boolean)
    .join("\n");

  return { title, headings, text, links, images, word_count: wordCount(text), schema_types };
}

/** Plain text a person pasted as a reference (for example a source excerpt). No headings, links or images. */
export function parsePlainText(title: string, text: string): ParsedDoc {
  const body = text.split(/\r?\n/).map(clean).filter(Boolean).join("\n");
  return { title: clean(title), headings: [], text: body, links: [], images: [], word_count: wordCount(body), schema_types: [] };
}

/** First n words of the body, used for the "keyword early" check. */
export function openingWords(doc: ParsedDoc, n = 100): string {
  return doc.text.split(/\s+/).slice(0, n).join(" ");
}
