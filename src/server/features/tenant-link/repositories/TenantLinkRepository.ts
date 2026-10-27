import { and, eq } from "drizzle-orm";
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

// Moves an existing link from `fromTenantId` to another tenant. Null when the
// organization was no longer linked to `fromTenantId` by the time the update
// ran, so a concurrent change is never overwritten.
async function repoint(
  link: TenantLink,
  fromTenantId: string,
): Promise<TenantLink | null> {
  const [row] = await db
    .update(organizationTenantLink)
    .set({
      tenantId: link.tenantId,
      linkedAt: link.linkedAt,
      linkedBy: link.linkedBy,
    })
    .where(
      and(
        eq(organizationTenantLink.organizationId, link.organizationId),
        eq(organizationTenantLink.tenantId, fromTenantId),
      ),
    )
    .returning();
  return row ?? null;
}

// With `tenantId`, deletes only the link to that tenant.
async function deleteByOrganizationId(
  organizationId: string,
  tenantId?: string,
): Promise<TenantLink | null> {
  const byOrganization = eq(
    organizationTenantLink.organizationId,
    organizationId,
  );
  const [row] = await db
    .delete(organizationTenantLink)
    .where(
      tenantId === undefined
        ? byOrganization
        : and(byOrganization, eq(organizationTenantLink.tenantId, tenantId)),
    )
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
