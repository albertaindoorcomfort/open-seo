import { GoogleOAuthSetupWarning } from "@/client/features/integrations/GoogleOAuthSetupWarning";
import { GSC_SELF_HOSTED_SETUP_DOCS_URL } from "@/shared/gsc";

/**
 * Shown while the deployment has no GOOGLE_CLIENT_ID/SECRET (hosted or
 * self-hosted), in both the Integrations card and the onboarding step.
 */
export function SelfHostedSetupWarning() {
  return (
    <GoogleOAuthSetupWarning
      integrationName="Search Console"
      docsUrl={GSC_SELF_HOSTED_SETUP_DOCS_URL}
    />
  );
}
