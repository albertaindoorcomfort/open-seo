import { createFileRoute } from "@tanstack/react-router";
import type { autumnHandler } from "autumn-js/fetch";
import { env } from "cloudflare:workers";
import { isHostedAuthMode } from "@/lib/auth-mode";
import { resolveHostedContext } from "@/middleware/ensure-user/hosted";
import { isLunarCheckoutBlocked } from "@/server/billing/lunar-checkout-gate";
import { usesPlaceholderBilling } from "@/server/billing/autumn-placeholder";

let handlerPromise: Promise<ReturnType<typeof autumnHandler>> | undefined;

// Lazy: keeps autumn-js/fetch out of the eager isolate startup graph;
// resolves instantly after the first request.
function loadHandler() {
  return (handlerPromise ??= import("autumn-js/fetch").then(
    ({ autumnHandler }) =>
      autumnHandler({
        identify: async (request) => {
          const context = await resolveHostedContext(request.headers);

          return {
            customerId: context.organizationId,
          };
        },
      }),
  ));
}

async function handleAutumnRequest(request: Request) {
  if (!isHostedAuthMode(env.AUTH_MODE)) {
    return new Response("Not found", {
      status: 404,
    });
  }

  if (isLunarCheckoutBlocked(request, env.LUNAR_OPTIMIZE_CHECKOUT_ENABLED)) {
    return Response.json(
      { error: "Lunar Optimize subscriptions are not available yet." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // No AUTUMN_SECRET_KEY: billing runs on the server-side placeholder ledger
  // and there is no Autumn account to show the client.
  if (await usesPlaceholderBilling()) {
    return Response.json(
      { error: "Billing is not configured on this deployment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return (await loadHandler())(request);
}

export const Route = createFileRoute("/api/autumn/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        return handleAutumnRequest(request);
      },
      POST: async ({ request }: { request: Request }) => {
        return handleAutumnRequest(request);
      },
    },
  },
});
