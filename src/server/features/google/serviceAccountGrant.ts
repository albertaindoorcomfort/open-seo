import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import {
  loadServiceAccountConfig,
  SERVICE_ACCOUNT_PREFIX,
} from "@/server/lib/googleServiceAccount";

export type ServiceAccountGrant = {
  id: string;
  accountId: string;
  email: string;
};

/** The service account as a grant, when this user is allowed to use it. */
export async function getServiceAccountGrantForUser(
  userId: string,
): Promise<ServiceAccountGrant | null> {
  const config = await loadServiceAccountConfig();
  if (!config) return null;
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const email = rows[0]?.email?.toLowerCase();
  if (!email || !config.allowedEmails.has(email)) return null;
  const accountId = `${SERVICE_ACCOUNT_PREFIX}${config.key.client_email}`;
  return { id: accountId, accountId, email: config.key.client_email };
}
