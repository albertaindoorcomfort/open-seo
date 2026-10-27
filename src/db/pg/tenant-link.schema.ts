import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";

// See src/db/tenant-link.schema.ts.
export const organizationTenantLink = pgTable(
  "organization_tenant_link",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull(),
    linkedAt: text("linked_at").notNull(),
    linkedBy: text("linked_by").notNull(),
  },
  (table) => [
    uniqueIndex("organization_tenant_link_tenant_id_idx").on(table.tenantId),
  ],
);
