import type { DashboardActivation } from "@/server/features/dashboard/services/DashboardService";
import type { DashboardHeroStep } from "@/types/schemas/dashboard";

const STEP_ORDER: DashboardHeroStep[] = ["domain", "mcp", "gsc", "competitor"];

/** The steps this deployment can coach, in order. Without the Google client
 *  ids nobody can connect Search Console, so its step is left out instead of
 *  staying undone forever. */
export function getDashboardSteps(
  activation: DashboardActivation,
): DashboardHeroStep[] {
  return STEP_ORDER.filter(
    (step) => step !== "gsc" || activation.gsc.googleOAuthConfigured,
  );
}

// A step is "done" when the underlying product state exists, regardless of
// how it got there. The MCP hero step completes at authorization (the card
// below owns the connected-but-no-call-yet coaching) or when the user said
// "I already connected".
export function isStepDone(
  activation: DashboardActivation,
  step: DashboardHeroStep,
): boolean {
  switch (step) {
    case "domain":
      return activation.domain !== null;
    case "mcp":
      return (
        activation.mcp.authorizedAt !== null ||
        activation.mcp.cardDismissedAt !== null
      );
    case "gsc":
      return activation.gsc.connected;
    case "competitor":
      return activation.competitorClickedAt !== null;
  }
}

/** The single step the hero should coach next; null = coaching is over. */
export function computeNextStep(
  activation: DashboardActivation,
): DashboardHeroStep | null {
  for (const step of getDashboardSteps(activation)) {
    if (!isStepDone(activation, step)) return step;
  }
  return null;
}
