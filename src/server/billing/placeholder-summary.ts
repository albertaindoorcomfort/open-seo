import {
  AUTUMN_MANAGED_ACCESS_FEATURE_ID,
  AUTUMN_PAID_PLAN_FEATURE_ID,
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  autumnSeoDataCreditsToUsd,
} from "@/shared/billing";
import {
  placeholderAutumn,
  placeholderDailyCredits,
} from "@/server/billing/autumn-placeholder";

export type PlaceholderBillingSummary = {
  dailyAllowanceUsd: number;
  remainingTodayUsd: number;
  // Rank checks and AI visibility (paid_plan gate).
  paidFeatures: boolean;
  // Site audits (managed_service_access gate).
  siteAudits: boolean;
};

/** What the placeholder ledger grants an organization today. Read through the
 *  ledger's own checks, the ones the server gates call, so the billing pages
 *  cannot promise more than the gates allow. */
export async function getPlaceholderBillingSummary(
  customerId: string,
): Promise<PlaceholderBillingSummary> {
  const [credits, paidPlan, managedAccess] = await Promise.all([
    placeholderAutumn.customers.getOrCreate({ customerId }),
    placeholderAutumn.check({
      customerId,
      featureId: AUTUMN_PAID_PLAN_FEATURE_ID,
    }),
    placeholderAutumn.check({
      customerId,
      featureId: AUTUMN_MANAGED_ACCESS_FEATURE_ID,
    }),
  ]);
  return {
    dailyAllowanceUsd: autumnSeoDataCreditsToUsd(placeholderDailyCredits()),
    remainingTodayUsd: autumnSeoDataCreditsToUsd(
      credits.balances[AUTUMN_SEO_DATA_BALANCE_FEATURE_ID].remaining,
    ),
    paidFeatures: paidPlan.allowed,
    siteAudits: managedAccess.allowed,
  };
}
