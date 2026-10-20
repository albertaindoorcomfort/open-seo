/**
 * Run the SEO/GEO agent's OpenSEO tools against a live OpenSEO instance the
 * way Apollo calls them: Apollo tool names, one MCP connection, normalized
 * results with evidence. Prints one JSON line per step.
 *
 * Usage:
 *   OPENSEO_URL=https://seo.example.com OPENSEO_API_KEY=oseo_... \
 *     pnpm tsx scripts/apollo-seo-run.ts --url=https://example.com
 *
 * OPENSEO_API_KEY may be omitted only for a local AUTH_MODE=local_noauth
 * instance. A site audit crawls the target site and uses no DataForSEO
 * credits unless Lighthouse is requested.
 */

import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  connectOpenSeoForApollo,
  createOpenSeoTransport,
  OpenSeoToolError,
} from "../src/integrations/apollo/client";
import { parseArgs } from "./cli-utils";

const args = parseArgs(process.argv.slice(2));
const siteUrl = typeof args.url === "string" ? args.url : null;
const maxPages = Number(args["max-pages"] ?? 20);
if (!siteUrl) throw new Error("Pass --url=<site to audit>");

const openSeo = await connectOpenSeoForApollo(
  createOpenSeoTransport({
    baseUrl: process.env.OPENSEO_URL ?? "http://localhost:3001",
    apiKey: process.env.OPENSEO_API_KEY,
  }),
);

const log = (step: string, data: unknown) =>
  console.log(JSON.stringify({ step, ...Object(data) }));

async function step(tool: string, toolArgs: Record<string, unknown>) {
  try {
    const outcome = await openSeo.call(tool, toolArgs);
    log(tool, {
      creditsCharged: outcome.creditsCharged,
      evidence: outcome.evidence,
    });
    return outcome.result;
  } catch (error) {
    if (!(error instanceof OpenSeoToolError)) throw error;
    log(tool, { blocked: error.code, reason: error.message });
    return null;
  }
}

try {
  const domain = new URL(siteUrl).hostname;
  const projects = await step("seo.list_projects", {});
  const list: unknown[] = Array.isArray(projects?.projects)
    ? projects.projects
    : [];
  const existing = list.map(Object).find((p) => p.domain === domain);
  const project =
    existing ?? (await step("seo.create_project", { name: domain, domain }));
  const projectId: unknown = existing?.id ?? Object(project?.project).id;
  if (typeof projectId !== "string") {
    throw new Error("No OpenSEO project to scope the run to");
  }

  const started = await step("seo.audit_start", {
    projectId,
    url: siteUrl,
    maxPages,
  });
  const auditId = typeof started?.auditId === "string" ? started.auditId : null;
  if (!auditId) throw new Error("Audit did not start");

  for (let i = 0; i < 60; i++) {
    await sleep(5_000);
    const status = await step("seo.audit_status", { projectId, auditId });
    const state: unknown = Object(status?.status).status;
    if (state === "completed" || state === "failed") break;
  }

  const issues = await step("seo.audit_issues", { projectId, auditId });
  log("summary", { auditId, summary: issues?.summary ?? null });

  // First-party Google data: reports NOT_CONNECTED until GSC/GA4 are linked.
  await step("seo.gsc_performance", { projectId });
  await step("seo.ga4_organic_overview", { projectId });
} finally {
  await openSeo.close();
}
