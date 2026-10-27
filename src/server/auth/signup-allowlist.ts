// Lunar Optimize: while billing runs on the placeholder ledger (no
// AUTUMN_SECRET_KEY), hosted sign-up is invite-only. The list comes from
// LUNAR_OPTIMIZE_ALLOWED_EMAILS (comma or whitespace separated); unset means
// the owner's address only.

import { usesPlaceholderBilling } from "@/server/billing/autumn-placeholder";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";

const DEFAULT_ALLOWED_EMAILS = "DigitalTools.Mgt@albertaindoorcomfort.com";

/** The invite gate, read by the sign-up hook (auth.ts) and by the landing
 *  page's call to action (/api/auth-options). It is coupled to billing: setting
 *  AUTUMN_SECRET_KEY opens public sign-up. */
export async function isSignupInviteOnly(): Promise<boolean> {
  return (await isHostedServerAuthMode()) && (await usesPlaceholderBilling());
}

export function parseAllowedEmails(raw: unknown): Set<string> {
  const source =
    typeof raw === "string" && raw.trim() !== "" ? raw : DEFAULT_ALLOWED_EMAILS;
  return new Set(
    source
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: string, raw: unknown): boolean {
  return parseAllowedEmails(raw).has(email.trim().toLowerCase());
}
