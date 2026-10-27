import { useQuery } from "@tanstack/react-query";
import { getBillingMode } from "@/serverFunctions/billing";

// Which billing rail serves this deployment, for /subscribe and /billing.
// billingMode is undefined while the lookup is in flight; a failed lookup
// falls through to the Autumn path, which reports its own state.
export function useBillingMode(hasSession: boolean) {
  const query = useQuery({
    queryKey: ["billingMode"],
    queryFn: () => getBillingMode(),
    enabled: hasSession,
  });
  const placeholder = query.data?.placeholder ?? null;
  const billingMode = placeholder
    ? ("placeholder" as const)
    : query.data || query.isError
      ? ("autumn" as const)
      : undefined;
  return { billingMode, placeholder };
}
