import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { hasGoogleSocialConfig } from "@/lib/auth";

export const getSeoApiKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(() => {
    const configured = Boolean(env.DATAFORSEO_API_KEY?.trim());
    // Without a key the data screens run on labelled sample data instead of
    // blocking. A refusal for auth, credits or quota is reported with the
    // response that received it (src/middleware/sampleData.ts), never from
    // here, so it cannot reach another user's banner.
    return {
      configured,
      sample: !configured,
      reason: configured ? null : ("no_key" as const),
    };
  });

// Public (no session): which sign-in methods this deployment offers, so the
// auth pages can hide Google when its ids are unset. Booleans only.
export const getAuthOptions = createServerFn({ method: "GET" }).handler(() => ({
  google: hasGoogleSocialConfig(),
}));
