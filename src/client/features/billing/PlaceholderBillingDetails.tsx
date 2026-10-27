import type { PlaceholderBillingSummary } from "@/server/billing/placeholder-summary";

// What /subscribe and /billing show while billing is the placeholder ledger:
// the real daily allowance, what it covers, and that nothing is for sale yet.
export function PlaceholderBillingDetails({
  summary,
}: {
  summary: PlaceholderBillingSummary;
}) {
  const included = [
    "Keyword research, SERP analysis, domain overview and backlinks",
    ...(summary.paidFeatures ? ["Rank tracking and AI visibility"] : []),
    ...(summary.siteAudits ? ["Site audits"] : []),
    "Content Score, project memory and the MCP server for your own AI agent",
  ];
  const notYet = [
    ...(summary.paidFeatures ? [] : ["Rank tracking and AI visibility"]),
    ...(summary.siteAudits ? [] : ["Site audits"]),
    "Paid plans, checkout and credit top-ups",
  ];

  return (
    <div className="space-y-4 text-left">
      <div className="rounded-lg border border-base-300 bg-base-100 p-4">
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="font-medium">Daily allowance</span>
          <span className="tabular-nums text-base-content/70">
            ${summary.dailyAllowanceUsd.toFixed(2)} a day
          </span>
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">
          ${summary.remainingTodayUsd.toFixed(2)}{" "}
          <span className="text-sm font-normal text-base-content/50">
            left today
          </span>
        </div>
        <p className="mt-1 text-xs text-base-content/60">
          Every data lookup draws on this allowance. It resets at midnight UTC.
        </p>
      </div>
      <FeatureList title="Included now" items={included} />
      <FeatureList title="Not available yet" items={notYet} />
    </div>
  );
}

function FeatureList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 p-4">
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-base-content/70">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
