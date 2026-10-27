import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_LOCATION_CODE } from "@/shared/keyword-locations";
import { LocationSelect } from "@/client/components/LocationSelect";
import { LunarMark } from "@/client/components/LunarMark";
import { useBillingMode } from "@/client/features/billing/useBillingMode";
import { useSamAccess } from "@/client/features/sam/useSamAccess";
import { useSession } from "@/lib/auth-client";
import { saveOnboardingSite } from "@/serverFunctions/onboardingChat";
import { OnboardingAccountMenu } from "./OnboardingAccountMenu";
import { OnboardingChatConversation } from "./OnboardingChatConversation";
import {
  invalidateOnboardingChatState,
  onboardingChatStateQueryOptions,
} from "./onboardingChatQueries";

// Full-viewport chat surface. Breaks out of the centered, padded AuthPageShell
// with `fixed inset-0` so the chat fills the screen. There's no header bar —
// the strategy's first message carries the context — and inner content is
// constrained to a narrow column for comfortable reading width.
function StrategyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col bg-base-100">{children}</div>
  );
}

export function OnboardingChat() {
  const navigate = useNavigate();
  const stateQuery = useQuery(onboardingChatStateQueryOptions());
  const { data: session } = useSession();
  const accountMenu = <OnboardingAccountMenu email={session?.user?.email} />;

  // This chat is a free preview that sells the paid plan through Autumn
  // checkout. The placeholder ledger has nothing to sell (its checkout answers
  // 503), and without a model key the chat cannot answer (the Worker refuses
  // the socket), so either way the user goes to their project instead.
  const projectId = stateQuery.data?.projectId ?? null;
  const { billingMode } = useBillingMode(Boolean(session?.user?.id));
  const samAccess = useSamAccess(projectId);
  const chatUnavailable =
    billingMode === "placeholder" || samAccess.showSetupGate;
  useEffect(() => {
    if (!projectId || !chatUnavailable) return;
    void navigate({
      to: "/p/$projectId",
      params: { projectId },
      replace: true,
    });
  }, [chatUnavailable, navigate, projectId]);

  if (stateQuery.isError) {
    return (
      <StrategyShell>
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-error">
          Couldn’t load your strategy. Please refresh to try again.
        </div>
      </StrategyShell>
    );
  }

  // Hold the loading state until both checks answer (and while redirecting),
  // so the conversation, and its Autumn checkout, only mounts once Autumn
  // serves billing and SAM can answer.
  if (
    !stateQuery.data ||
    billingMode === undefined ||
    samAccess.isChecking ||
    chatUnavailable
  ) {
    return (
      <StrategyShell>
        <div className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-base-content/60">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      </StrategyShell>
    );
  }

  const { domain } = stateQuery.data;

  return (
    <StrategyShell>
      {accountMenu}
      {!domain ? (
        <SiteForm projectId={stateQuery.data.projectId} />
      ) : (
        <OnboardingChatConversation
          projectId={stateQuery.data.projectId}
          domain={domain}
        />
      )}
    </StrategyShell>
  );
}

function SiteForm({ projectId }: { projectId: string }) {
  const [domain, setDomain] = useState("");
  const [locationCode, setLocationCode] = useState(DEFAULT_LOCATION_CODE);

  const save = useMutation({
    mutationFn: () =>
      saveOnboardingSite({ data: { projectId, domain, locationCode } }),
    onSuccess: invalidateOnboardingChatState,
  });

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <form
        className="w-full max-w-md space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (domain.trim()) {
            save.mutate();
          }
        }}
      >
        <div className="space-y-3 text-center">
          <LunarMark />
          <h1 className="text-xl font-semibold">Tell us about your website.</h1>
          <p className="text-sm text-base-content/60">
            If you have multiple websites, you can set that up later.
          </p>
        </div>

        <div className="space-y-4 rounded-lg border border-base-300 bg-base-100 p-5 shadow-sm">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Your website</span>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="example.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">
              This is the country we will use when getting SEO data.
            </span>
            <LocationSelect value={locationCode} onChange={setLocationCode} />
          </label>

          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={!domain.trim() || save.isPending}
          >
            {save.isPending ? "Saving…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
