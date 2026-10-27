import { AlertTriangle, Info } from "lucide-react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { isHostedClientAuthMode } from "@/lib/auth-mode";

// Shown in place of the Connect button while the deployment has no Google
// client ids. Hosted users cannot fix that themselves, so they get a short
// explanation; self-hosters get the setup guide.
export function GoogleOAuthSetupWarning({
  integrationName,
  docsUrl,
}: {
  integrationName: string;
  docsUrl: string;
}) {
  if (isHostedClientAuthMode()) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-base-300 bg-base-200/40 p-3.5 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-base-content/60" />
        <div className="space-y-1">
          <p className="font-medium">Not available yet</p>
          <p className="text-base-content/70">
            Connecting {integrationName} needs Google sign-in, which Lunar
            Optimize does not offer yet. Every other feature works without it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="alert alert-warning items-start text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-medium">Google OAuth client not configured</p>
        <p className="text-base-content/70">
          Add your Google client ID and secret to this Lunar Optimize deployment
          before connecting {integrationName}.
        </p>
        <SafeExternalLink
          url={docsUrl}
          label="Open setup guide"
          className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
        />
      </div>
    </div>
  );
}
