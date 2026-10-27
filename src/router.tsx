import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import {
  createIsomorphicFn,
  getGlobalStartContext,
} from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";
import { DefaultCatchBoundary } from "./client/components/DefaultCatchBoundary";
import { NotFound } from "./client/components/NotFound";

// The request's CSP nonce, passed in as request context by
// withContentSecurityPolicy (src/server/lib/contentSecurityPolicy.ts). The
// router puts it on every inline script it renders. In the browser there is
// none here: hydration reads it back from the csp-nonce meta tag.
const getRequestNonce = createIsomorphicFn()
  .server(() => {
    const context: unknown = getGlobalStartContext();
    return typeof context === "object" &&
      context !== null &&
      "nonce" in context &&
      typeof context.nonce === "string"
      ? context.nonce
      : undefined;
  })
  .client(() => undefined);

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: true,
    ssr: { nonce: getRequestNonce() },
  });

  return router;
}
