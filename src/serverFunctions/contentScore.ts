import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildContentReferenceFromPages } from "@/server/lib/referencePages";
import { requireProjectContext } from "@/serverFunctions/middleware";

// Free (no DataForSEO call): fetches only the pages the person names, through
// the audit's SSRF guard, and returns counts for the browser's live scorer.
const buildReferenceSchema = z.object({
  projectId: z.string().min(1),
  keyword: z.string().trim().min(2).max(80),
  urls: z.array(z.string().url().max(2000)).max(5).default([]),
  texts: z
    .array(z.object({ title: z.string().max(240), text: z.string().max(20_000) }))
    .max(5)
    .default([]),
});

export const buildContentReference = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(buildReferenceSchema)
  .handler(async ({ data }) => buildContentReferenceFromPages(data));
