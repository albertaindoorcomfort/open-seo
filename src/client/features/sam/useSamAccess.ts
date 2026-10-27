import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getSamAccessSetupStatus } from "@/serverFunctions/samAccess";

type SamAccess = {
  // False until the server confirms a usable model key.
  available: boolean;
  // True only once the check has resolved to "no access".
  showSetupGate: boolean;
  isChecking: boolean;
  errorMessage: string | null;
  isRefetching: boolean;
  onRetry: () => void;
};

// projectId is null outside a project (the sidebar), where nothing is checked.
export function useSamAccess(projectId: string | null): SamAccess {
  const { data, error, isRefetching, refetch } = useQuery({
    queryKey: ["samAccessStatus", projectId],
    queryFn: () =>
      getSamAccessSetupStatus({ data: { projectId: projectId ?? "" } }),
    enabled: projectId !== null,
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  const onRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const resolved = data !== undefined || error != null;
  return {
    available: data?.enabled === true,
    showSetupGate: resolved && !(data?.enabled ?? false),
    isChecking: !resolved,
    errorMessage:
      data?.errorMessage ??
      (error
        ? getStandardErrorMessage(
            error,
            "Could not load AI agent setup status.",
          )
        : null),
    isRefetching,
    onRetry,
  };
}
