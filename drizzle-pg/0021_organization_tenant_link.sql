CREATE TABLE "organization_tenant_link" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"linked_at" text NOT NULL,
	"linked_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_tenant_link" ADD CONSTRAINT "organization_tenant_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_tenant_link_tenant_id_idx" ON "organization_tenant_link" USING btree ("tenant_id");