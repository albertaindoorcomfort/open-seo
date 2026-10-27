import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { routeAgentRequest } from "agents";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { SamSessionRepository } from "@/server/features/sam/SamSessionRepository";
import { refuseChatWhenSamUnavailable } from "@/server/features/sam/samAccess";
import { runScheduledRankChecks } from "@/server/features/rank-tracking/services/scheduledRankChecks";
import { reconcileStaleAudits } from "@/server/features/audit/services/auditReconciler";
import { getOrCreateOrganizationCustomer } from "@/server/billing/subscription";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { getAuthMode, isHostedAuthMode } from "@/lib/auth-mode";
import {
  createOpenSeoOAuthProvider,
  type OpenSeoOAuthEnv,
} from "@/server/mcp/oauth-provider";
import { requestWithPublicOrigin } from "@/server/mcp/public-origin";
import { MCP_ROUTE } from "@/server/mcp/context";
import { handleSelfHostedOpenSeoMcpRequest } from "@/server/mcp/transport";
import { withPgClient } from "@/db";
import {
  TENANT_LINK_PATH,
  handleTenantLinkRequest,
} from "@/server/features/tenant-link/tenant-link-endpoint";
import {
  AUTUMN_WEBHOOK_PATH,
  handleAutumnWebhookRequest,
} from "@/server/billing/autumn-webhook";
import { maybeSendSelfHostHeartbeat } from "@/server/lib/self-host-telemetry";
import { handleGdprStorageErasure } from "@/server/gdpr/storage-erasure";
import { GDPR_STORAGE_ERASURE_PATH } from "@/shared/gdpr-erasure";
import { HEALTH_PREFIX, handleHealthRequest } from "@/server/health";
import { CRON_TRIGGER_PATH, handleCronTrigger } from "@/server/cron-trigger";

const appFetch = createStartHandler(defaultStreamHandler);
const openSeoOAuthProvider = createOpenSeoOAuthProvider(appFetch);

// Authorize an onboarding-chat connection in the Worker, before it reaches the
// Durable Object. The DO instance name is the projectId (set client-side); we
// resolve the session here and confirm the caller's org owns that project, so
// the DO can trust its `name`. Returning a Response rejects; void lets it through.
async function authorizeOnboardingChat(
  request: Request,
  projectId: string,
): Promise<Response | undefined> {
  let context;
  try {
    context = await resolveUserContextFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  // The onboarding chat runs on the same model key as SAM.
  const samUnavailable = await refuseChatWhenSamUnavailable();
  if (samUnavailable) return samUnavailable;
  const project = await ProjectRepository.getProjectForOrganization(
    projectId,
    context.organizationId,
  );
  if (!project) {
    return new Response("Forbidden", { status: 403 });
  }
  // Ensure the org's Autumn customer exists (and gets its default onboarding-plan
  // credits) before the DO checks the balance — otherwise a brand-new org's first
  // message can hit a false "out of credits" gate. Hosted-only; self-hosted has
  // no Autumn.
  if (await isHostedServerAuthMode()) {
    await getOrCreateOrganizationCustomer(context);
  }
  return undefined;
}

// Authorize a SAM agent connection in the Worker, before it reaches the Durable
// Object. The DO instance name is the sessionId (set client-side); we resolve
// the session here and authorize the caller against the session's project via
// the same canonical project-access check the rest of the app uses, so the DO
// can trust its `name` and derive org/project/user from the session row.
async function authorizeSamChat(
  request: Request,
  sessionId: string,
): Promise<Response | undefined> {
  let context;
  try {
    context = await resolveUserContextFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const samUnavailable = await refuseChatWhenSamUnavailable();
  if (samUnavailable) return samUnavailable;
  const session = await SamSessionRepository.getActiveSession(
    sessionId,
    context.userId,
  );
  const project = session
    ? await ProjectRepository.getProjectForOrganization(
        session.projectId,
        context.organizationId,
      )
    : null;
  if (!session || !project) {
    return new Response("Forbidden", { status: 403 });
  }
  // Same as onboarding above: make sure the Autumn customer (and its default
  // free-plan credits) exists before the DO's balance gate runs, or a brand-new
  // org's first message hits a false "out of credits".
  if (await isHostedServerAuthMode()) {
    await getOrCreateOrganizationCustomer(context);
  }
  return undefined;
}

// Both chat DOs live behind /agents/*. Dispatch on the DO binding partyserver
// resolved for the request (rather than re-parsing the path), and fail closed
// on anything unrecognized.
function authorizeChatAgent(
  request: Request,
  lobby: { className: string; name: string },
): Promise<Response | undefined> | Response {
  switch (lobby.className) {
    case "SAM_CHAT":
      return authorizeSamChat(request, lobby.name);
    case "ONBOARDING_CHAT":
      return authorizeOnboardingChat(request, lobby.name);
    default:
      return new Response("Forbidden", { status: 403 });
  }
}

// Route /agents/* to the onboarding and SAM chat DOs. Auth happens here (both
// the WS upgrade and any HTTP message-history fetch), keeping it off the OAuth
// wrapper and TanStack route guard below.
async function routeChatAgents(request: Request, env: Env): Promise<Response> {
  const response = await routeAgentRequest(request, env, {
    onBeforeConnect: (req, lobby) => authorizeChatAgent(req, lobby),
    onBeforeRequest: (req, lobby) => authorizeChatAgent(req, lobby),
  });
  return response ?? new Response("Not found", { status: 404 });
}

function fetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Scope a per-request Postgres client (no-op in D1 mode). The client isn't
  // closed here — the Workers↔Hyperdrive socket is reclaimed at invocation end.
  return withPgClient(() => Promise.resolve(handleFetch(request, env, ctx)));
}

function handleFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Response | Promise<Response> {
  ctx.waitUntil(maybeSendSelfHostHeartbeat());

  const authMode = getAuthMode(env.AUTH_MODE);
  const publicRequest = requestWithPublicOrigin(request);
  const pathname = new URL(publicRequest.url).pathname;

  if (pathname === GDPR_STORAGE_ERASURE_PATH) {
    return handleGdprStorageErasure(publicRequest, env);
  }

  // Operator routes, ahead of auth and the app: health probes, and the
  // loopback cron trigger for runtimes that never fire `scheduled`.
  if (pathname.startsWith(HEALTH_PREFIX)) {
    return handleHealthRequest(publicRequest, env);
  }
  if (pathname === CRON_TRIGGER_PATH) {
    return handleCronTrigger(publicRequest, env, (cron) =>
      runScheduled(cron, env),
    );
  }

  if (pathname.startsWith("/agents/")) {
    return routeChatAgents(publicRequest, env);
  }

  // Platform machine principal (Mission Control); its own Bearer secret.
  if (pathname === TENANT_LINK_PATH) {
    return handleTenantLinkRequest(publicRequest, env);
  }

  if (isHostedAuthMode(authMode)) {
    if (pathname === AUTUMN_WEBHOOK_PATH) {
      return handleAutumnWebhookRequest(publicRequest);
    }

    return openSeoOAuthProvider.fetch(
      publicRequest,
      env as OpenSeoOAuthEnv,
      ctx,
    );
  }

  if (
    (authMode === "cloudflare_access" || authMode === "local_noauth") &&
    pathname === MCP_ROUTE
  ) {
    return handleSelfHostedOpenSeoMcpRequest(publicRequest, authMode, env, ctx);
  }

  return appFetch(request);
}

// Export Workflow classes as named exports
export { SiteAuditWorkflow } from "./server/workflows/SiteAuditWorkflow";
export { RankCheckWorkflow } from "./server/workflows/RankCheckWorkflow";
// Durable Object class for the onboarding strategy chat (Agents SDK).
export { OnboardingChatAgent } from "./server/features/onboarding/OnboardingChatAgent";
// Durable Object class for the SAM in-app agent (Agents SDK).
export { SamChatAgent } from "./server/features/sam/SamChatAgent";
// Durable Object class for the per-audit crawl scratchpad.
export { AuditScratchpad } from "./server/features/audit/AuditScratchpad";

// Daily OAuth KV garbage collection; must match a trigger in wrangler.jsonc.
const MCP_OAUTH_PURGE_CRON = "17 3 * * *";

// Runs one cron tick. Called by the Workers runtime and, where crons never
// fire (wrangler dev on the box, vite preview in Docker), by POST /internal/cron.
async function runScheduled(cron: string, env: Env): Promise<void> {
  if (cron === MCP_OAUTH_PURGE_CRON) {
    // Only hosted mode runs the OAuth provider (and has OAUTH_KV bound).
    if (isHostedAuthMode(getAuthMode(env.AUTH_MODE))) {
      const result = await openSeoOAuthProvider.purgeExpiredData(
        env as OpenSeoOAuthEnv,
      );
      console.log("[mcp-oauth] purged expired OAuth data", result);
      if (!result.done) {
        // The sweep only advances past live records via deletions; a
        // persistent incomplete scan means the keyspace outgrew the batch.
        console.warn("[mcp-oauth] purge did not cover the full keyspace");
      }
    }
    return;
  }

  // Watchdog first: reconcile audits stuck in "running" whose workflow died
  // without reaching mark-failed (OOM/CPU kills, expired instances). Runs
  // before the rank loop so a slow tick can't delay or starve it. Its
  // failure is held until after the rank checks so it can't suppress them,
  // then rethrown so the invocation still reports as failed.
  let watchdogError: unknown;
  try {
    await withPgClient(() => reconcileStaleAudits());
  } catch (err) {
    watchdogError = err;
    console.error("[cron] Stale-audit reconcile failed:", err);
  }
  // Scope a per-request Postgres client for the cron run (no-op in D1 mode).
  await withPgClient(() => runScheduledRankChecks(env));
  if (watchdogError) throw watchdogError;
}

export default {
  fetch,
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    await runScheduled(controller.cron, env);
  },
};
