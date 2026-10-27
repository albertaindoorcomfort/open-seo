import { getEnvValueSync } from "@/server/lib/runtime-env";

// Operator health, to the contract the tenant OS and the deploy gate read:
//   /health/live          200 while the worker answers
//   /health/ready         200 only when every required dependency answers, else 503
//   /health/dependencies  per-dependency state; names services, never env vars
// Unlike /api/health in hosted mode, ready is not a constant: a missing database
// or KV binding returns 503 so a deploy gate can roll back.

export const HEALTH_PREFIX = "/health/";

type DependencyState = "ok" | "down" | "not_configured";

type Dependency = {
  name: string;
  required: boolean;
  state: DependencyState;
};

type HealthEnv = {
  DB?: { prepare: (sql: string) => { first: () => Promise<unknown> } };
  KV?: { get: (key: string) => Promise<unknown> };
  R2?: { head: (key: string) => Promise<unknown> };
};

async function probe(check: () => Promise<unknown>): Promise<DependencyState> {
  try {
    await check();
    return "ok";
  } catch {
    return "down";
  }
}

function configured(env: object, name: string): DependencyState {
  return getEnvValueSync(env, name) ? "ok" : "not_configured";
}

export async function checkDependencies(env: object): Promise<Dependency[]> {
  const bindings = env as HealthEnv;
  const [database, kv, storage] = await Promise.all([
    bindings.DB
      ? probe(() =>
          bindings.DB!.prepare("select 1 from projects limit 1").first(),
        )
      : Promise.resolve<DependencyState>("down"),
    bindings.KV
      ? probe(() => bindings.KV!.get("health:probe"))
      : Promise.resolve<DependencyState>("down"),
    bindings.R2
      ? probe(() => bindings.R2!.head("health/probe"))
      : Promise.resolve<DependencyState>("down"),
  ]);
  return [
    { name: "database", required: true, state: database },
    { name: "key_value", required: true, state: kv },
    { name: "object_storage", required: true, state: storage },
    {
      name: "seo_data_provider",
      required: false,
      state: configured(env, "DATAFORSEO_API_KEY"),
    },
    {
      name: "google_search_console",
      required: false,
      state:
        configured(env, "GOOGLE_SERVICE_ACCOUNT_JSON") === "ok" ||
        configured(env, "GOOGLE_CLIENT_ID") === "ok"
          ? "ok"
          : "not_configured",
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
  env: object,
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
    const body =
      path === "/health/ready"
        ? { status: ready ? "ok" : "unavailable" }
        : { status: ready ? "ok" : "unavailable", dependencies };
    return Response.json(body, { status: ready ? 200 : 503, headers: noStore });
  }
  return new Response("Not found", { status: 404, headers: noStore });
}
