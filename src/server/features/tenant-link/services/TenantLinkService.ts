import {
  TenantLinkRepository,
  type TenantLink,
} from "@/server/features/tenant-link/repositories/TenantLinkRepository";

// E1: an Optimize organization is its Mission Control tenant. One organization
// maps to one tenant and one tenant to one organization; the table's primary
// key and unique index hold that even if two writers race.

type LinkInput = {
  organizationId: string;
  tenantId: string;
  actor: string;
  // Allows moving an organization that is already linked to another tenant.
  replace?: boolean;
};

type LinkResult =
  | { status: "linked" | "unchanged" | "replaced"; link: TenantLink }
  | {
      status: "conflict";
      reason:
        | "organization_linked_to_other_tenant"
        | "tenant_linked_to_other_organization";
      link: TenantLink;
    }
  | { status: "unknown_organization" };

type UnlinkResult =
  | { status: "unlinked"; link: TenantLink }
  | { status: "not_linked" };

// One line per change, for the journal. Ids and the actor only. Warn level
// because the box runs wrangler dev with --log-level warn, which drops
// console.log and console.info.
function logChange(fields: {
  event: "linked" | "replaced" | "unlinked";
  organizationId: string;
  tenantId: string;
  actor: string;
  previousTenantId?: string;
}) {
  console.warn(
    JSON.stringify({ ...fields, event: `tenant_link.${fields.event}` }),
  );
}

async function link(input: LinkInput): Promise<LinkResult> {
  const current = await TenantLinkRepository.getByOrganizationId(
    input.organizationId,
  );
  if (current?.tenantId === input.tenantId) {
    return { status: "unchanged", link: current };
  }
  if (current && !input.replace) {
    return {
      status: "conflict",
      reason: "organization_linked_to_other_tenant",
      link: current,
    };
  }
  // Never take a tenant from another organization, replace or not: the
  // platform unlinks that organization first.
  const owner = await TenantLinkRepository.getByTenantId(input.tenantId);
  if (owner) {
    return {
      status: "conflict",
      reason: "tenant_linked_to_other_organization",
      link: owner,
    };
  }

  const next: TenantLink = {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    linkedAt: new Date().toISOString(),
    linkedBy: input.actor,
  };

  if (current) {
    const row = await TenantLinkRepository.repoint(next);
    if (!row) throw new Error("Tenant link disappeared during replace");
    logChange({
      event: "replaced",
      organizationId: row.organizationId,
      tenantId: row.tenantId,
      actor: input.actor,
      previousTenantId: current.tenantId,
    });
    return { status: "replaced", link: row };
  }

  if (!(await TenantLinkRepository.organizationExists(input.organizationId))) {
    return { status: "unknown_organization" };
  }
  const row = await TenantLinkRepository.insert(next);
  logChange({
    event: "linked",
    organizationId: row.organizationId,
    tenantId: row.tenantId,
    actor: input.actor,
  });
  return { status: "linked", link: row };
}

async function unlink(input: {
  organizationId: string;
  actor: string;
}): Promise<UnlinkResult> {
  const removed = await TenantLinkRepository.deleteByOrganizationId(
    input.organizationId,
  );
  if (!removed) return { status: "not_linked" };
  logChange({
    event: "unlinked",
    organizationId: removed.organizationId,
    tenantId: removed.tenantId,
    actor: input.actor,
  });
  return { status: "unlinked", link: removed };
}

function getTenantForOrganization(
  organizationId: string,
): Promise<TenantLink | null> {
  return TenantLinkRepository.getByOrganizationId(organizationId);
}

function getOrganizationForTenant(
  tenantId: string,
): Promise<TenantLink | null> {
  return TenantLinkRepository.getByTenantId(tenantId);
}

export const TenantLinkService = {
  link,
  unlink,
  getTenantForOrganization,
  getOrganizationForTenant,
};
