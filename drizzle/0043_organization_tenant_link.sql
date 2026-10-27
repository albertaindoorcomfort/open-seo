CREATE TABLE `organization_tenant_link` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`linked_by` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_tenant_link_tenant_id_idx` ON `organization_tenant_link` (`tenant_id`);