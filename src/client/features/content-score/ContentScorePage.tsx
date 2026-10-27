import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import {
  scoreContent,
  type ContentReference,
  type ContentScore,
} from "@/lib/seo-engine";
import { buildContentReference } from "@/serverFunctions/contentScore";

const SEVERITY: Record<string, { label: string; className: string }> = {
  fix: { label: "Fix", className: "badge-error" },
  improve: { label: "Improve", className: "badge-warning" },
  info: { label: "Note", className: "badge-ghost" },
};

/** Re-score as the draft changes, after a short pause in typing. Runs in the browser; no request per keystroke. */
function useLiveScore(
  input: { title: string; meta: string; slug: string; body: string },
  keyword: string,
  reference: ContentReference | null,
  siteHost: string,
): ContentScore | null {
  const [score, setScore] = React.useState<ContentScore | null>(null);
  React.useEffect(() => {
    if (keyword.trim().length < 2 || !input.body.trim()) return;
    const timer = window.setTimeout(() => {
      setScore(
        scoreContent(
          { title: input.title, meta_description: input.meta || undefined, slug: input.slug || undefined, body: input.body },
          keyword,
          reference,
          { site_host: siteHost.trim() || undefined },
        ),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [input.title, input.meta, input.slug, input.body, keyword, reference, siteHost]);
  return keyword.trim().length < 2 || !input.body.trim() ? null : score;
}

export function ContentScorePage({ projectId }: { projectId: string }) {
  const [keyword, setKeyword] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [meta, setMeta] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [body, setBody] = React.useState("");
  const [site, setSite] = React.useState("");
  const [urls, setUrls] = React.useState("");
  const [reference, setReference] = React.useState<ContentReference | null>(null);
  const score = useLiveScore({ title, meta, slug, body }, keyword, reference, site);

  const referenceMutation = useMutation({
    mutationFn: () =>
      buildContentReference({
        data: {
          projectId,
          keyword: keyword.trim(),
          urls: urls.split(/\s+/).map((u) => u.trim()).filter(Boolean).slice(0, 5),
          texts: [],
        },
      }),
    onSuccess: (result) => setReference(result.reference.pages.length > 0 ? result.reference : null),
  });
  const failed = referenceMutation.data?.attempts.filter((a) => !a.ok) ?? [];
  const urlList = urls.split(/\s+/).filter(Boolean);

  return (
    <div className="px-4 py-4 md:px-6 md:py-6 pb-24 md:pb-8 overflow-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold">Content Score</h1>
          <p className="text-sm text-base-content/70">
            Write against a target keyword and see a live 0 to 100 score with what to change. Compare with the pages
            that rank by adding their addresses.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="flex flex-col gap-3" aria-label="Draft">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="label-text text-sm">Target keyword</span>
                <input className="input input-bordered w-full" value={keyword} maxLength={80} onChange={(e) => setKeyword(e.target.value)} placeholder="heat pump installation cost" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label-text text-sm">Your site (for internal links)</span>
                <input className="input input-bordered w-full" value={site} onChange={(e) => setSite(e.target.value)} placeholder="yoursite.com" />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="label-text text-sm">Title</span>
              <input className="input input-bordered w-full" value={title} maxLength={240} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="label-text text-sm">Meta description</span>
                <input className="input input-bordered w-full" value={meta} maxLength={320} onChange={(e) => setMeta(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label-text text-sm">Slug</span>
                <input className="input input-bordered w-full" value={slug} maxLength={120} onChange={(e) => setSlug(e.target.value)} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="label-text text-sm">Article (Markdown)</span>
              <textarea className="textarea textarea-bordered min-h-80 w-full font-mono text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder={"# Heading\n\nOpening paragraph..."} spellCheck />
            </label>

            <div className="rounded-lg border border-base-300 p-3">
              <p className="text-sm font-medium">Compare against</p>
              <p className="text-xs text-base-content/70">
                {reference
                  ? `${reference.pages.length} pages, ${reference.terms.length} terms${reference.word_count ? `, ${reference.word_count.target_min} to ${reference.word_count.target_max} words` : ""}.`
                  : "No reference yet: topic coverage is not measured and length uses a default range."}
              </p>
              <label className="mt-2 flex flex-col gap-1">
                <span className="label-text text-xs">Competitor pages (https, up to 5, one per line)</span>
                <textarea className="textarea textarea-bordered w-full text-sm" rows={3} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://example.com/heat-pump-cost" />
              </label>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={referenceMutation.isPending || keyword.trim().length < 2 || urlList.length === 0 || urlList.length > 5}
                  onClick={() => referenceMutation.mutate()}
                >
                  {referenceMutation.isPending ? "Measuring pages..." : "Measure these pages"}
                </button>
                {reference && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReference(null)}>
                    Clear
                  </button>
                )}
              </div>
              {referenceMutation.isError && <p className="mt-2 text-sm text-error">The pages could not be measured.</p>}
              {failed.length > 0 && (
                <ul className="mt-2 text-xs text-base-content/70">
                  {failed.map((a) => <li key={a.url}>{a.url}: {a.error}</li>)}
                </ul>
              )}
            </div>
          </section>

          <aside aria-label="Content score" className="flex flex-col gap-3">
            {score ? <ScorePanel score={score} /> : (
              <div className="rounded-lg border border-dashed border-base-300 p-5 text-sm text-base-content/70">
                Enter a target keyword and some text to see the score.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function ScorePanel({ score }: { score: ContentScore }) {
  const measured = score.components.filter((c) => c.max > 0);
  return (
    <div className="rounded-lg border border-base-300 p-4">
      <div className="flex flex-wrap items-baseline gap-2" aria-live="polite">
        <span className="text-4xl font-semibold tabular-nums">{score.score}</span>
        <span className="text-sm text-base-content/70">/100 for "{score.keyword}"</span>
        <span className="badge badge-outline capitalize">{score.band}</span>
      </div>
      <p className="mt-1 text-xs text-base-content/70">
        {score.measured.word_count} words, {score.measured.subheadings} subheadings
        {score.measured.flesch !== null ? `, reading ease ${score.measured.flesch}` : ""}
      </p>
      <ul className="mt-3 flex flex-col gap-2" aria-label="Score by area">
        {measured.map((c) => (
          <li key={c.id} className="text-sm">
            <div className="flex justify-between"><span>{c.label}</span><span className="tabular-nums text-base-content/70">{Math.round(c.points)} / {c.max}</span></div>
            <progress className="progress progress-primary w-full" value={c.points} max={c.max} />
          </li>
        ))}
      </ul>
      {score.guidance.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium">What to change</p>
          <ul className="mt-2 flex flex-col gap-2">
            {score.guidance.map((g) => (
              <li key={g.id} className="flex items-start gap-2 text-sm">
                <span className={`badge badge-sm shrink-0 ${SEVERITY[g.severity]?.className ?? ""}`}>{SEVERITY[g.severity]?.label}</span>
                <span>{g.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {score.terms.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Reference terms ({score.terms.length})</summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {score.terms.map((t) => (
              <li key={t.term} className={`badge badge-sm ${t.status === "ok" ? "badge-success" : t.status === "missing" ? "badge-ghost" : "badge-warning"}`}>
                {t.term} {t.count}/{t.target_min}-{t.target_max}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">How this is measured</summary>
        <ul className="mt-2 list-disc pl-5 text-xs text-base-content/70">
          {score.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </details>
    </div>
  );
}
