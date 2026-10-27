import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Sidebar } from "@/client/components/Sidebar";
import { dataforseoHelpLinkOptions } from "@/client/navigation/items";

const SAMPLE_TEXT: Record<string, string> = {
  no_key: "DataForSEO is not connected",
  credits: "DataForSEO is out of credits",
  auth: "DataForSEO refused the key",
  quota: "DataForSEO's request limit was reached",
};

/**
 * The persistent "Sample data" notice: while DataForSEO has no key or no credits, keyword, results, rank and
 * backlink numbers are made-up samples (server/lib/dataforseo/sample.ts). It never blocks a screen.
 */
function SeoApiStatusBanners({
  sampleReason,
  seoApiKeyStatusError,
}: {
  sampleReason: string | null;
  seoApiKeyStatusError: boolean;
}) {
  return (
    <>
      {sampleReason ? (
        <div className="shrink-0 px-4 py-2 md:px-6">
          <div className="mx-auto max-w-7xl">
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warning px-3 py-2 text-sm"
            >
              <span className="badge badge-warning badge-outline font-semibold">
                Sample data
              </span>
              <span className="text-base-content/80">
                {SAMPLE_TEXT[sampleReason] ?? "DataForSEO is not answering"}, so
                keyword, results, rank and backlink numbers are samples. Add
                DATAFORSEO_API_KEY or top up credits for live data (
                <Link
                  {...dataforseoHelpLinkOptions}
                  className="link link-primary font-medium"
                >
                  setup steps
                </Link>
                ).
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {seoApiKeyStatusError ? (
        <div className="shrink-0 px-4 py-2.5 md:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="alert alert-info">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="text-sm">
                We could not verify your DataForSEO setup. If features are not
                working, check the setup steps on the{" "}
                <Link
                  {...dataforseoHelpLinkOptions}
                  className="link link-primary font-medium"
                >
                  help page
                </Link>
                .
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MobileSidebarDrawer({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close sidebar"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <div className="absolute left-0 top-0 h-full shadow-xl">
        <Sidebar projectId={projectId} onNavigate={onClose} onClose={onClose} />
      </div>
    </div>
  );
}

export { MobileSidebarDrawer, SeoApiStatusBanners };
