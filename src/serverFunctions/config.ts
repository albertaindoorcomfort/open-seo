import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { dataforseoSampleReason } from "@/server/lib/dataforseo/sample";

export const getSeoApiKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(() => {
    const configured = Boolean(env.DATAFORSEO_API_KEY?.trim());
    // Without a key (or after DataForSEO refused a call for auth, credits or
    // quota) the data screens run on labelled sample data instead of blocking.
    const reason = configured ? dataforseoSampleReason() : "no_key";
    return { configured, sample: reason !== null, reason };
  });
