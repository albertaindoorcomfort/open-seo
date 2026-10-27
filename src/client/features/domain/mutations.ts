import { useMutation, type QueryClient } from "@tanstack/react-query";
import { saveKeywords } from "@/serverFunctions/keywords";

export function useSaveKeywordsMutation({
  projectId,
  queryClient,
}: {
  projectId: string;
  queryClient: QueryClient;
}) {
  return useMutation({
    mutationFn: (data: {
      projectId: string;
      keywords: string[];
      locationCode?: number;
    }) => saveKeywords({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["savedKeywords", projectId],
      });
    },
  });
}
