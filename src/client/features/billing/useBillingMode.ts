import { useQuery } from "@tanstack/react-query";
import { getBillingMode } from "@/serverFunctions/billing";

// The placeholder allowance drains as the user works, so the project banner
// and billing pages re-read it while the tab is open.
const PLACEHOLDER_REFRESH_MS = 60 * 1000;

// Which billing rail serves this deployment, for the billing pages, the plan
// gates and the project banner. billingMode is undefined while the lookup is
// in flight (or disabled); a failed lookup falls through to the Autumn path,
// which reports its own state.
export function useBillingMode(enabled: boolean) {
  const query = useQuery({
    queryKey: ["billingMode"],
    queryFn: () => getBillingMode(),
    enabled,
    refetchInterval: (current) =>
      current.state.data?.placeholder ? PLACEHOLDER_REFRESH_MS : false,
  });
  const placeholder = query.data?.placeholder ?? null;
  const billingMode = placeholder
    ? ("placeholder" as const)
    : query.data || query.isError
      ? ("autumn" as const)
      : undefined;
  return { billingMode, placeholder };
}
