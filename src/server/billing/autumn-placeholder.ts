// Lunar Optimize placeholder billing: stands in for Autumn while
// AUTUMN_SECRET_KEY is unset, so hosted mode is usable before billing exists
// (owner, 2026-10-21). Same limits shape as Autumn's check/track/customer
// reads: a daily SEO-data credit allowance derived from
// LUNAR_OPTIMIZE_DAILY_USD (default 2 USD), spend recorded per organization
// per UTC day in KV. It grants the paid plan (sign-up is invite-only while
// this ledger is active, see LUNAR_OPTIMIZE_ALLOWED_EMAILS) and never charges
// anyone. Setting AUTUMN_SECRET_KEY switches every call back to Autumn.

import { env } from "cloudflare:workers";
import {
  AUTUMN_MANAGED_ACCESS_FEATURE_ID,
  AUTUMN_PAID_PLAN_FEATURE_ID,
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_CREDITS_PER_USD,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
} from "@/shared/billing";
import {
  getOptionalEnvValue,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";

const DEFAULT_DAILY_USD = 2;

/** True when no Autumn key is set: billing runs on this local ledger. */
export async function usesPlaceholderBilling(): Promise<boolean> {
  try {
    return !(await getOptionalEnvValue("AUTUMN_SECRET_KEY"))?.trim();
  } catch {
    return true;
  }
}

/** True when this ledger's daily allowance is what users actually live under:
 *  hosted mode with no Autumn key. Self-hosted runs no billing gates at all,
 *  so it has no allowance to show or to explain. */
export async function isPlaceholderBillingActive(): Promise<boolean> {
  return (await isHostedServerAuthMode()) && (await usesPlaceholderBilling());
}

export function placeholderDailyCredits(
  raw: unknown = Reflect.get(env, "LUNAR_OPTIMIZE_DAILY_USD"),
): number {
  const usd = Number(raw);
  const daily =
    typeof raw === "string" &&
    raw.trim() !== "" &&
    Number.isFinite(usd) &&
    usd >= 0
      ? usd
      : DEFAULT_DAILY_USD;
  return Math.round(daily * AUTUMN_SEO_DATA_CREDITS_PER_USD);
}

function spendKey(customerId: string, now = new Date()): string {
  return `placeholder-billing:${customerId}:${now.toISOString().slice(0, 10)}`;
}

async function spentToday(customerId: string): Promise<number> {
  try {
    return Number(await env.KV.get(spendKey(customerId))) || 0;
  } catch {
    return 0;
  }
}

async function remainingToday(customerId: string): Promise<number> {
  return Math.max(
    0,
    placeholderDailyCredits() - (await spentToday(customerId)),
  );
}

/**
 * D1 (owner, 2026-10-27): while this ledger is active, sign-up is invite-only
 * (src/lib/auth.ts), so the ledger grants managed_service_access to every
 * invited organization and site audits run. The switch is
 * LUNAR_OPTIMIZE_PLACEHOLDER_MANAGED_ACCESS: unset or "on" grants it (the D1
 * default), "off" (or "false", "0", "no") denies it again. Real billing
 * (AUTUMN_SECRET_KEY) never reads it.
 */
function placeholderGrantsManagedAccess(
  raw: unknown = Reflect.get(env, "LUNAR_OPTIMIZE_PLACEHOLDER_MANAGED_ACCESS"),
): boolean {
  return !(
    typeof raw === "string" &&
    ["off", "false", "0", "no"].includes(raw.trim().toLowerCase())
  );
}

type CheckArgs = { customerId: string; featureId: string };
// Autumn allows track() by event name with no featureId; the ledger then records nothing.
type TrackArgs = { customerId: string; featureId?: string; value?: number };

export const placeholderAutumn = {
  async check({ customerId, featureId }: CheckArgs) {
    if (featureId === AUTUMN_PAID_PLAN_FEATURE_ID)
      return { allowed: true, customerId, featureId };
    if (featureId === AUTUMN_MANAGED_ACCESS_FEATURE_ID)
      return {
        allowed: placeholderGrantsManagedAccess(),
        customerId,
        featureId,
      };
    if (featureId === AUTUMN_SEO_DATA_BALANCE_FEATURE_ID) {
      const remaining = await remainingToday(customerId);
      return {
        allowed: remaining > 0,
        customerId,
        featureId,
        balance: { featureId, remaining, granted: placeholderDailyCredits() },
      };
    }
    if (featureId === AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID) {
      return {
        allowed: false,
        customerId,
        featureId,
        balance: { featureId, remaining: 0, granted: 0 },
      };
    }
    return { allowed: false, customerId, featureId };
  },

  async track({ customerId, featureId, value = 0 }: TrackArgs) {
    if (
      featureId === AUTUMN_SEO_DATA_BALANCE_FEATURE_ID ||
      featureId === AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID
    ) {
      const total = (await spentToday(customerId)) + Math.max(0, value);
      // Kept two days so the key outlives the UTC day it counts.
      await env.KV.put(spendKey(customerId), String(total), {
        expirationTtl: 2 * 24 * 60 * 60,
      });
    }
    return { customerId, featureId, value };
  },

  customers: {
    async getOrCreate({
      customerId: rawId,
      email,
    }: {
      customerId: string | null;
      email?: string | null;
    }) {
      const customerId = rawId ?? "anonymous";
      const remaining = await remainingToday(customerId);
      return {
        id: customerId,
        email: email ?? null,
        balances: {
          [AUTUMN_SEO_DATA_BALANCE_FEATURE_ID]: {
            featureId: AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
            remaining,
            granted: placeholderDailyCredits(),
          },
          [AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID]: {
            featureId: AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
            remaining: 0,
            granted: 0,
          },
        },
      };
    },
  },
};
