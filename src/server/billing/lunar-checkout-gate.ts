// A separate Lunar price and usage allowance have not been approved. The
// upstream Autumn plan must never become a Lunar checkout by accident.
export function isLunarCheckoutBlocked(
  request: Pick<Request, "method" | "url">,
  enabled: string | undefined,
) {
  if (request.method !== "POST") return false;
  const pathname = new URL(request.url).pathname;
  if (enabled === "true") return false;

  // Autumn exposes several ways to purchase or change a subscription. Keep
  // customer/usage reads and the existing customer portal available.
  const allowedPostRoutes = new Set([
    "getOrCreateCustomer",
    "getEntity",
    "openCustomerPortal",
    "listPlans",
    "listEvents",
    "aggregateEvents",
  ]);
  const route = pathname.slice("/api/autumn/".length);
  return pathname.startsWith("/api/autumn/") && !allowedPostRoutes.has(route);
}
