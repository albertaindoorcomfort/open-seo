import { getEnvValueSync } from "@/server/lib/runtime-env";

// Scheduled work for runtimes that never fire crons (wrangler dev on a box,
// vite preview in the Docker image). A host timer POSTs here with
// `Authorization: Bearer <CRON_TRIGGER_SECRET>` and `?cron=<expression>`.
// Unset or short secret means the route answers 404, as if it did not exist.

export const CRON_TRIGGER_PATH = "/internal/cron";

// Must match the triggers in wrangler.jsonc.
export const CRON_EXPRESSIONS = ["*/5 * * * *", "17 3 * * *"] as const;

const MIN_SECRET_LENGTH = 32;

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handleCronTrigger(
  request: Request,
  env: object,
  run: (cron: string) => Promise<void>,
): Promise<Response> {
  const secret = getEnvValueSync(env, "CRON_TRIGGER_SECRET");
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!sameText(auth, `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const cron = new URL(request.url).searchParams.get("cron") ?? "";
  if (!(CRON_EXPRESSIONS as readonly string[]).includes(cron)) {
    return Response.json({ error: "unknown cron" }, { status: 400 });
  }
  const started = Date.now();
  try {
    await run(cron);
  } catch (error) {
    console.error("[cron-trigger] scheduled run failed", cron, error);
    return Response.json({ status: "failed", cron }, { status: 500 });
  }
  return Response.json({ status: "ok", cron, ms: Date.now() - started });
}
