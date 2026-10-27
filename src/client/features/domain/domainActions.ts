import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { captureClientEvent } from "@/client/lib/posthog";

type SaveMutation = (payload: {
  projectId: string;
  keywords: string[];
  locationCode?: number;
}) => void;

type SaveOptions = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

export function saveSelectedKeywords({
  selectedKeywords,
  save,
  projectId,
  locationCode,
}: {
  selectedKeywords: Set<string>;
  save: (payload: Parameters<SaveMutation>[0], opts?: SaveOptions) => void;
  projectId: string;
  locationCode?: number;
}) {
  if (selectedKeywords.size === 0) {
    toast.error("Select at least one keyword first");
    return;
  }

  // Only the keywords: the server never takes metrics from the browser (they
  // may be sample data). "Update keyword stats" on the saved list fills them.
  save(
    {
      projectId,
      keywords: [...selectedKeywords],
      locationCode,
    },
    {
      onSuccess: () => {
        captureClientEvent("keyword:save", {
          source_feature: "domain_overview",
          keyword_count: selectedKeywords.size,
        });
        toast.success(`Saved ${selectedKeywords.size} keywords`);
      },
      onError: (error: unknown) => {
        toast.error(getStandardErrorMessage(error, "Save failed."));
      },
    },
  );
}
