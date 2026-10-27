import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { organization } from "./better-auth-schema";

// The link from an Optimize organization to its Mission Control tenant
// (tenants.tenant_id). One organization is one tenant: the primary key keeps an
// organization on one tenant and the unique index keeps a tenant on one
// organization. Only the platform writes it, through /internal/tenant-link.
export const organizationTenantLink = sqliteTable(
  "organization_tenant_link",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull(),
    // ISO-8601 UTC, written by the repository.
    linkedAt: text("linked_at").notNull(),
    // The platform actor that made the link, as the platform names it.
    linkedBy: text("linked_by").notNull(),
  },
  (table) => [
    uniqueIndex("organization_tenant_link_tenant_id_idx").on(table.tenantId),
  ],
);
