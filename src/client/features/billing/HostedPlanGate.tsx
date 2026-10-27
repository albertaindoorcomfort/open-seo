import type { ReactNode } from "react";
import { useCustomer } from "autumn-js/react";
import { useSession } from "@/lib/auth-client";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { getCustomerPlanStatus } from "@/client/features/billing/plan-detection";
import { useBillingMode } from "@/client/features/billing/useBillingMode";

export type HostedPlanGateState = {
  isLoading: boolean;
  isFreePlan: boolean;
};

export function HostedPlanGate({
  children,
}: {
  children: (state: HostedPlanGateState) => ReactNode;
}) {
  const state = useHostedPlanStatus();
  return children(state);
}

/**
 * The organization's plan, for the hosted plan gates. Self-hosted resolves to
 * the paid tier on the server, so it looks nothing up. The placeholder ledger
 * (no AUTUMN_SECRET_KEY) has no Autumn customer and its proxy answers 503, so
 * its own summary answers and Autumn is only asked when it serves billing.
 * While the plan is unknown, isFreePlan stays false rather than flash free-plan
 * copy at paid users; the server enforces the limits regardless.
 */
export function useHostedPlanStatus(): HostedPlanGateState {
  const hosted = isHostedClientAuthMode();
  const { data: session, isPending: isSessionPending } = useSession();
  const hasSession = Boolean(session?.user?.id);
  const { billingMode, placeholder } = useBillingMode(hosted && hasSession);
  const customerQuery = useCustomer({
    queryOptions: { enabled: hosted && hasSession && billingMode === "autumn" },
  });

  if (!hosted) {
    return { isLoading: false, isFreePlan: false };
  }
  if (placeholder) {
    return { isLoading: false, isFreePlan: !placeholder.paidFeatures };
  }
  return {
    isLoading:
      isSessionPending ||
      !hasSession ||
      billingMode === undefined ||
      customerQuery.isLoading,
    isFreePlan:
      !!customerQuery.data &&
      getCustomerPlanStatus(customerQuery.data) === "free",
  };
}
