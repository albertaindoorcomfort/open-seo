import {
  getOptionalEnvValue,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";

const OPENROUTER_KEY_MISSING_MESSAGE =
  "OPENROUTER_API_KEY is not set for this deployment yet. Add it to your environment, restart Lunar Optimize, then confirm here.";

type SamAccessStatus = {
  enabled: boolean;
  // Setup instructions for self-hosters; null for hosted users, who cannot
  // set the key themselves.
  errorMessage: string | null;
};

/** Whether the in-app agent (SAM) can answer: every turn needs a model key
 *  (SamChatAgent.getModel), in hosted and self-hosted mode alike. */
export async function getSamAccessStatus(): Promise<SamAccessStatus> {
  if ((await getOptionalEnvValue("OPENROUTER_API_KEY"))?.trim()) {
    return { enabled: true, errorMessage: null };
  }
  return {
    enabled: false,
    errorMessage: (await isHostedServerAuthMode())
      ? null
      : OPENROUTER_KEY_MISSING_MESSAGE,
  };
}
