import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization, organizationTenantLink } from "@/db/schema";

export type TenantLink = typeof organizationTenantLink.$inferSelect;

async function getByOrganizationId(
  organizationId: string,
): Promise<TenantLink | null> {
  const rows = await db
    .select()
    .from(organizationTenantLink)
    .where(eq(organizationTenantLink.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

async function getByTenantId(tenantId: string): Promise<TenantLink | null> {
  const rows = await db
    .select()
    .from(organizationTenantLink)
    .where(eq(organizationTenantLink.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

async function organizationExists(organizationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return rows.length > 0;
}

async function insert(link: TenantLink): Promise<TenantLink> {
  const [row] = await db
    .insert(organizationTenantLink)
    .values(link)
    .returning();
  if (!row) throw new Error("Failed to insert organization_tenant_link");
  return row;
}

// Moves an existing link to another tenant. Null when the organization had no
// link by the time the update ran.
async function repoint(link: TenantLink): Promise<TenantLink | null> {
  const [row] = await db
    .update(organizationTenantLink)
    .set({
      tenantId: link.tenantId,
      linkedAt: link.linkedAt,
      linkedBy: link.linkedBy,
    })
    .where(eq(organizationTenantLink.organizationId, link.organizationId))
    .returning();
  return row ?? null;
}

async function deleteByOrganizationId(
  organizationId: string,
): Promise<TenantLink | null> {
  const [row] = await db
    .delete(organizationTenantLink)
    .where(eq(organizationTenantLink.organizationId, organizationId))
    .returning();
  return row ?? null;
}

export const TenantLinkRepository = {
  getByOrganizationId,
  getByTenantId,
  organizationExists,
  insert,
  repoint,
  deleteByOrganizationId,
};
