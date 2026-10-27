import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCustomer } from "autumn-js/react";
import { useEffect, useState } from "react";
import { ArrowRight, Settings, User } from "lucide-react";
import { ThemePreferenceMenuItems } from "@/client/components/ThemePreferenceMenuItems";
import { LunarMark } from "@/client/components/LunarMark";
import { captureClientEvent } from "@/client/lib/posthog";
import { signOutAndRedirect, useSession } from "@/lib/auth-client";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getSubscribeRouteState } from "@/client/features/billing/route-state";
import { getCustomerPlanStatus } from "@/client/features/billing/plan-detection";
import { PlaceholderBillingDetails } from "@/client/features/billing/PlaceholderBillingDetails";
import { useBillingMode } from "@/client/features/billing/useBillingMode";
import { normalizeAuthRedirect } from "@/lib/auth-redirect";
import {
  AUTUMN_MANAGED_ACCESS_FEATURE_ID,
  AUTUMN_PAID_PLAN_ID,
  LUNAR_MONTHLY_PRICE_USD,
  LUNAR_MONTHLY_USAGE_CREDIT_USD,
} from "@/shared/billing";

const PLAN_FEATURES = [
  "Keyword research, backlinks, rank tracking, and site audits",
  "MCP server and agent skills for Claude, Cursor, and ChatGPT",
  "Google Search Console Integration",
  `Includes $${LUNAR_MONTHLY_USAGE_CREDIT_USD.toFixed(2)} of metered usage credits each month`,
];

// How long the post-checkout "finalizing" screen polls Autumn before giving
// up and letting the user through anyway.
const FINALIZING_TIMEOUT_MS = 30_000;

export const Route = createFileRoute("/_authenticated/subscribe")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { upgrade?: true; redirect?: string; checkout?: "success" } => ({
    upgrade:
      search.upgrade === true || search.upgrade === "true" ? true : undefined,
    redirect:
      typeof search.redirect === "string"
        ? normalizeAuthRedirect(search.redirect)
        : undefined,
    checkout: search.checkout === "success" ? "success" : undefined,
  }),
  component: SubscribePage,
});

function SubscribePage() {
  const navigate = useNavigate();
  const { upgrade: isUpgradeFlow, redirect, checkout } = Route.useSearch();
  const { data: session } = useSession();
  const [isAttaching, setIsAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalizingTimedOut, setFinalizingTimedOut] = useState(false);
  const checkoutCompleted = checkout === "success";

  const hasSession = Boolean(session?.user?.id);
  const { billingMode, placeholder } = useBillingMode(hasSession);
  const customerQuery = useCustomer({
    queryOptions: {
      enabled: hasSession && billingMode === "autumn",
    },
  });

  // Read managed access from the already-loaded Autumn customer (local, no API
  // call) instead of a separate server round-trip. Self-hosted has no Autumn
  // customer, so mirror the server's "always granted" behavior there.
  const hasManagedAccess = isHostedClientAuthMode()
    ? customerQuery.check({ featureId: AUTUMN_MANAGED_ACCESS_FEATURE_ID })
        .allowed
    : true;

  const planStatus = getCustomerPlanStatus(customerQuery.data);
  const subscribeRouteState = getSubscribeRouteState({
    hasSession,
    billingMode,
    checkoutEnabled:
      import.meta.env.VITE_LUNAR_OPTIMIZE_CHECKOUT_ENABLED === "true",
    isCustomerLoading: customerQuery.isLoading,
    isCustomerError: customerQuery.isError,
    hasManagedAccess,
    planStatus,
    isUpgradeFlow: isUpgradeFlow === true,
    checkoutCompleted,
    finalizingTimedOut,
  });

  // Autumn can lag Stripe by a few seconds after checkout; poll until the
  // subscription shows up so the just-paid user isn't shown the paywall again.
  const isFinalizing = subscribeRouteState === "finalizing";
  const { refetch: refetchCustomer } = customerQuery;
  useEffect(() => {
    if (!isFinalizing) return;
    const interval = setInterval(() => {
      void refetchCustomer();
    }, 2000);
    return () => clearInterval(interval);
  }, [refetchCustomer, isFinalizing]);

  // Armed once on landing with checkout=success (not on the finalizing state,
  // which a transient poll error can leave and re-enter) so the deadline is a
  // hard bound from arrival.
  useEffect(() => {
    if (!checkoutCompleted || finalizingTimedOut) return;
    const timeout = setTimeout(
      () => setFinalizingTimedOut(true),
      FINALIZING_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [checkoutCompleted, finalizingTimedOut]);

  useEffect(() => {
    if (subscribeRouteState === "redirectToApp") {
      if (checkoutCompleted) {
        captureClientEvent("billing:checkout_success");
      }
      void navigate({ href: redirect ?? "/", replace: true });
    }
  }, [checkoutCompleted, navigate, redirect, subscribeRouteState]);

  useEffect(() => {
    if (subscribeRouteState === "showPaywall" && !isUpgradeFlow) {
      captureClientEvent("billing:paywall_viewed");
    }
  }, [isUpgradeFlow, subscribeRouteState]);

  if (
    subscribeRouteState === "loading" ||
    subscribeRouteState === "redirectToApp"
  ) {
    return null;
  }

  if (subscribeRouteState === "placeholder" && placeholder) {
    return (
      <div className="w-full max-w-sm space-y-5">
        <SubscribePageAccountMenu email={session?.user?.email} />
        <div className="text-center space-y-3">
          <LunarMark />
          <h1 className="text-xl font-semibold">
            Early access, free of charge
          </h1>
          <p className="text-sm text-base-content/60">
            Paid plans are not on sale yet, so there is nothing to buy and
            nobody is charged. Your workspace runs on a free daily allowance.
          </p>
        </div>
        <PlaceholderBillingDetails summary={placeholder} />
        <Link to="/workspace" className="btn btn-soft w-full">
          Open workspace
        </Link>
      </div>
    );
  }

  // The fork's upstream plan is not an approved Lunar Optimize offer.
  // The Autumn attach route applies the same default-closed gate server-side.
  if (subscribeRouteState === "checkoutDisabled") {
    return (
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-base-300 bg-base-100 p-6 text-center">
        <h1 className="text-xl font-semibold">Lunar Optimize subscriptions</h1>
        <p className="text-sm text-base-content/70">
          Enrollment is being configured. Your existing workspace and available
          free-plan features remain accessible.
        </p>
        <Link to="/workspace" className="btn btn-soft w-full">
          Open workspace
        </Link>
      </div>
    );
  }

  if (subscribeRouteState === "finalizing") {
    return (
      <div className="w-full max-w-xs space-y-4 text-center">
        <LunarMark />
        <h1 className="text-xl font-semibold">
          Finalizing your subscription&hellip;
        </h1>
        <span className="loading loading-spinner loading-md" />
        <p className="text-sm text-base-content/60">
          This usually takes a few seconds.
        </p>
        <p className="text-xs text-base-content/50">
          Taking longer? Refresh your billing status in a moment.
        </p>
      </div>
    );
  }

  if (subscribeRouteState === "error") {
    return (
      <div className="w-full max-w-xs space-y-4">
        <div className="text-center space-y-3">
          <LunarMark />
          <h1 className="text-xl font-semibold">Billing unavailable</h1>
        </div>

        <p className="text-sm text-center text-base-content/70">
          {getStandardErrorMessage(
            customerQuery.error,
            "We couldn't verify your billing status right now. Please try again.",
          )}
        </p>

        <button
          type="button"
          className="btn btn-soft w-full"
          onClick={() => {
            void customerQuery.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  async function handleSubscribe() {
    setError(null);
    setIsAttaching(true);

    try {
      captureClientEvent("billing:checkout_start");
      const successUrl = new URL(window.location.href);
      successUrl.searchParams.set("checkout", "success");
      await customerQuery.attach({
        planId: AUTUMN_PAID_PLAN_ID,
        redirectMode: "always",
        successUrl: successUrl.toString(),
      });
    } catch (err) {
      setError(
        getStandardErrorMessage(
          err,
          "We couldn't start the checkout. Please try again.",
        ),
      );
      setIsAttaching(false);
    }
  }

  const firstName = session?.user?.name?.split(" ")[0] || "";

  return (
    <div className="w-full max-w-sm space-y-6">
      <SubscribePageAccountMenu email={session?.user?.email} />

      <div className="text-center space-y-3">
        <LunarMark />
        <h1 className="text-xl font-semibold">
          {isUpgradeFlow
            ? "Upgrade your plan"
            : firstName
              ? `Welcome to Lunar Optimize, ${firstName}!`
              : "Welcome to Lunar Optimize!"}
        </h1>
        <p className="text-sm text-base-content/60">
          SEO on your terms. All your SEO tools in one place at a fair price.
        </p>
      </div>

      <div className="rounded-lg border border-base-300 p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-semibold">Base Plan</span>
          <span className="text-lg font-semibold tabular-nums">
            ${LUNAR_MONTHLY_PRICE_USD}/month
          </span>
        </div>

        <ul className="space-y-2">
          {PLAN_FEATURES.map((item) => (
            <li
              key={item}
              className="flex gap-2.5 text-sm text-base-content/70"
            >
              <span className="text-base-content/40 mt-[2px] shrink-0">
                &mdash;
              </span>
              {item}
            </li>
          ))}
          {/* Sub-bullet of the Usage Credits line above. */}
          <li className="-mt-1 pl-6 text-xs">
            Usage is metered by feature. Check the billing page for your
            remaining credits.
          </li>
        </ul>

        {error ? <p className="text-sm text-error">{error}</p> : null}

        <button
          className="btn btn-soft w-full"
          disabled={isAttaching}
          onClick={() => void handleSubscribe()}
        >
          {isAttaching ? "Redirecting..." : "Subscribe"}
        </button>

        <p className="text-center text-xs text-base-content/50">
          Review the confirmed subscription terms before paying.
        </p>
      </div>

      <div className="text-center space-y-2">
        {isUpgradeFlow ? (
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-base-content/70 hover:text-base-content transition-colors"
            onClick={() => void navigate({ to: "/", replace: true })}
          >
            <ArrowRight className="size-3.5 rotate-180" />
            Back to app
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SubscribePageAccountMenu({ email }: { email: string | undefined }) {
  if (!email) return null;

  const handleSignOut = () => signOutAndRedirect();

  return (
    <div className="fixed top-4 right-4">
      <div className="dropdown dropdown-end">
        <button
          type="button"
          tabIndex={0}
          className="btn btn-ghost btn-circle"
          aria-label="Open account menu"
        >
          <User className="h-5 w-5" />
        </button>
        <ul
          tabIndex={0}
          className="dropdown-content z-20 menu mt-3 min-w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          <li className="menu-title max-w-full">
            <span className="truncate text-base-content" data-ph-mask>
              {email}
            </span>
          </li>
          <li>
            <Link to="/settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </li>
          <ThemePreferenceMenuItems />
          <li>
            <button
              type="button"
              className="text-error"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
