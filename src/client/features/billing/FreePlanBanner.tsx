import { Link } from "@tanstack/react-router";
import { useCustomer } from "autumn-js/react";
import { useSession } from "@/lib/auth-client";
import { getCustomerPlanStatus } from "@/client/features/billing/plan-detection";
import { getPlaceholderAllowanceNotice } from "@/client/features/billing/placeholder-allowance";
import { useBillingMode } from "@/client/features/billing/useBillingMode";
import {
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
  BILLING_ROUTE,
  LOW_CREDITS_THRESHOLD_USD,
  SUBSCRIBE_ROUTE,
  autumnSeoDataCreditsToUsd,
} from "@/shared/billing";

export function FreePlanBanner() {
  const checkoutEnabled =
    import.meta.env.VITE_LUNAR_OPTIMIZE_CHECKOUT_ENABLED === "true";
  const { data: session } = useSession();
  const hasSession = Boolean(session?.user?.id);
  const { billingMode, placeholder } = useBillingMode(hasSession);
  // The placeholder ledger has no Autumn customer (its proxy answers 503), so
  // Autumn is only asked once it is known to serve billing.
  const customerQuery = useCustomer({
    queryOptions: {
      enabled: hasSession && billingMode === "autumn",
    },
  });

  if (placeholder) {
    const notice = getPlaceholderAllowanceNotice(placeholder);
    if (!notice) return null;
    return (
      <BannerShell variant={notice.variant}>
        {notice.message}{" "}
        <Link to={BILLING_ROUTE} className="link link-primary font-medium">
          See your allowance
        </Link>
      </BannerShell>
    );
  }

  if (customerQuery.isLoading || !customerQuery.data) {
    return null;
  }

  const planStatus = getCustomerPlanStatus(customerQuery.data);
  const isFreePlan = planStatus === "free";

  const monthlyRemaining = autumnSeoDataCreditsToUsd(
    customerQuery.data.balances?.[AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]
      ?.remaining ?? 0,
  );
  const topUpRemaining = autumnSeoDataCreditsToUsd(
    customerQuery.data.balances?.[AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID]
      ?.remaining ?? 0,
  );
  const totalRemaining = monthlyRemaining + topUpRemaining;

  const isOutOfCredits = totalRemaining <= 0;
  const isLowCredits =
    !isOutOfCredits && totalRemaining < LOW_CREDITS_THRESHOLD_USD;

  const creditsActionLink = isFreePlan ? (
    <Link
      to={SUBSCRIBE_ROUTE}
      search={{ upgrade: true }}
      className="link link-primary font-medium"
    >
      Upgrade your plan
    </Link>
  ) : (
    <Link to={BILLING_ROUTE} className="link link-primary font-medium">
      Buy more credits
    </Link>
  );

  if (!checkoutEnabled && isFreePlan) {
    return (
      <BannerShell variant={isOutOfCredits ? "warning" : "info"}>
        Lunar Optimize enrollment is being configured. Your current usage
        balance is ${totalRemaining.toFixed(2)}.
      </BannerShell>
    );
  }

  if (isOutOfCredits) {
    return (
      <BannerShell variant="error">
        You&rsquo;ve used all your credits. {creditsActionLink} to continue
        using Lunar Optimize.
      </BannerShell>
    );
  }

  if (isLowCredits) {
    return (
      <BannerShell variant="warning">
        You&rsquo;re running low on credits. {creditsActionLink} to keep using
        Lunar Optimize.
      </BannerShell>
    );
  }

  if (isFreePlan) {
    return (
      <BannerShell variant="info">
        We hope you&rsquo;re enjoying Lunar Optimize!{" "}
        <Link
          to={SUBSCRIBE_ROUTE}
          search={{ upgrade: true }}
          className="link link-primary font-medium"
        >
          Upgrade anytime
        </Link>{" "}
        or{" "}
        <Link to="/support" className="link link-primary font-medium">
          reach out with questions
        </Link>
        .
      </BannerShell>
    );
  }

  return null;
}

function BannerShell({
  variant,
  children,
}: {
  variant: "info" | "warning" | "error";
  children: React.ReactNode;
}) {
  const alertClass =
    variant === "error"
      ? "alert-error"
      : variant === "warning"
        ? "alert-warning"
        : "alert-info";

  return (
    <div className="shrink-0 px-4 py-2.5 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className={`alert text-sm ${alertClass}`}>
          <span>{children}</span>
        </div>
      </div>
    </div>
  );
}
