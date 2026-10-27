import type { PlaceholderBillingSummary } from "@/server/billing/placeholder-summary";
import {
  LOW_CREDITS_THRESHOLD_USD,
  PLACEHOLDER_ALLOWANCE_USED_MESSAGE,
} from "@/shared/billing";

type PlaceholderAllowanceNotice = {
  variant: "warning" | "error";
  message: string;
};

/** The project banner's line while billing is the placeholder ledger, shown
 *  only once today's allowance is nearly or fully spent. Nothing is for sale,
 *  so it says when the allowance comes back instead of offering an upgrade. */
export function getPlaceholderAllowanceNotice(
  summary: Pick<
    PlaceholderBillingSummary,
    "dailyAllowanceUsd" | "remainingTodayUsd"
  >,
): PlaceholderAllowanceNotice | null {
  if (summary.remainingTodayUsd <= 0) {
    return { variant: "error", message: PLACEHOLDER_ALLOWANCE_USED_MESSAGE };
  }
  if (summary.remainingTodayUsd < LOW_CREDITS_THRESHOLD_USD) {
    return {
      variant: "warning",
      message: `You have $${summary.remainingTodayUsd.toFixed(2)} left of today's $${summary.dailyAllowanceUsd.toFixed(2)} free allowance. It resets at midnight UTC.`,
    };
  }
  return null;
}
