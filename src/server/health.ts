import { db } from "@/db";
import { projects } from "@/db/schema";
import { getEnvValueSync } from "@/server/lib/runtime-env";

// Operator health, to the contract the tenant OS and the deploy gate read:
//   /health/live          200 while the worker answers
//   /health/ready         200 only when every required dependency answers, else 503
//   /health/dependencies  per-dependency state; names services, never env vars
// Unlike /api/health in hosted mode, ready is not a constant: a database
// without the app's tables, or a missing KV or R2 binding, returns 503 so a
// deploy gate can roll back. /api/health stays as it is for older probes.

export const HEALTH_PREFIX = "/health/";

type DependencyState = "ok" | "down" | "not_configured";

type Dependency = {
  name: string;
  required: boolean;
  state: DependencyState;
};

type HealthEnv = {
  KV?: { get: (key: string) => Promise<unknown> };
  R2?: { head: (key: string) => Promise<unknown> };
};

// A missing binding is down, like one that throws.
async function probe(
  check: (() => Promise<unknown>) | undefined,
): Promise<DependencyState> {
  if (!check) return "down";
  try {
    await check();
    return "ok";
  } catch {
    return "down";
  }
}

function configured(env: HealthEnv, ...names: string[]): DependencyState {
  return names.every((name) => getEnvValueSync(env, name))
    ? "ok"
    : "not_configured";
}

async function checkDependencies(env: HealthEnv): Promise<Dependency[]> {
  const { KV, R2 } = env;
  const [database, keyValue, objectStorage] = await Promise.all([
    // A real app table through the provider-aware client: an unmigrated
    // database (or a missing binding) is not ready.
    probe(() => db.select({ id: projects.id }).from(projects).limit(1)),
    probe(KV && (() => KV.get("health:probe"))),
    probe(R2 && (() => R2.head("health/probe"))),
  ]);
  return [
    { name: "database", required: true, state: database },
    { name: "key_value", required: true, state: keyValue },
    { name: "object_storage", required: true, state: objectStorage },
    {
      name: "seo_data_provider",
      required: false,
      state: configured(env, "DATAFORSEO_API_KEY"),
    },
    {
      name: "google_oauth",
      required: false,
      state: configured(env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
    },
    {
      name: "language_model",
      required: false,
      state: configured(env, "OPENROUTER_API_KEY"),
    },
  ];
}

const noStore = { "Cache-Control": "no-store" };

export async function handleHealthRequest(
  request: Request,
  env: HealthEnv,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD", ...noStore },
    });
  }
  const path = new URL(request.url).pathname;
  if (path === "/health/live") {
    return Response.json({ status: "ok" }, { headers: noStore });
  }
  if (path === "/health/ready" || path === "/health/dependencies") {
    const dependencies = await checkDependencies(env);
    const ready = dependencies.every((d) => !d.required || d.state === "ok");
    const status = ready ? "ok" : "unavailable";
    const body =
      path === "/health/ready" ? { status } : { status, dependencies };
    return Response.json(body, { status: ready ? 200 : 503, headers: noStore });
  }
  return new Response("Not found", { status: 404, headers: noStore });
}
