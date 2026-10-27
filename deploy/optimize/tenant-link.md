# Tenant link (S6): how the platform calls it

Each Optimize organization is linked to exactly one Mission Control tenant
(`tenants.tenant_id`), and each tenant to exactly one organization. The link
lives in the table `organization_tenant_link` (migration
`drizzle/0043_organization_tenant_link.sql`, Postgres
`drizzle-pg/0021_organization_tenant_link.sql`). Only the platform writes it.

## Setup (names only)

- `OPTIMIZE_PLATFORM_SECRET` in `/opt/lunar-optimize/app.env`: at least 32
  characters, for example from `openssl rand -hex 32`. Unset or shorter means
  the endpoint answers 404. Never print the value.
- Mission Control holds the same value in its own environment and sends it as a
  Bearer token.
- The migration applies on service start (`migrate.sh` is the unit's
  `ExecStartPre`).
- Until `box-install.sh` merges `app.env` instead of rewriting it, a reinstall
  drops this key and the endpoint goes back to 404. Add it again after a
  reinstall.

## Calling it

Mission Control runs on the same box, so it calls the app on loopback:
`http://127.0.0.1:3601/internal/tenant-link`. Do not call it through the public
host: once the P0-2 nginx rule is live, `/internal/` answers 404 there.

Every request carries `Authorization: Bearer <OPTIMIZE_PLATFORM_SECRET>`.

| Request       | Body or query                                                      | Answer                                                  |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `GET`         | `?organizationId=<id>` or `?tenantId=<id>` (exactly one)           | `200 {"link": {...}}` or `200 {"link": null}`           |
| `POST` link   | `{"action":"link","organizationId","tenantId","actor","replace"?}` | `200` with `status` `linked`, `unchanged` or `replaced` |
| `POST` unlink | `{"action":"unlink","organizationId","actor"}`                     | `200` with `status` `unlinked` or `not_linked`          |

`actor` is who made the change, as the platform names it (for example the
Mission Control user id). A link reads back as `organizationId`, `tenantId`,
`linkedAt` and `linkedBy`.

Refusals (a `409` body carries `status: "conflict"`, the `reason` and the
current `link`):

- `409`, reason `organization_linked_to_other_tenant`: the organization is
  already linked to another tenant. Send `"replace": true` to move it.
- `409`, reason `tenant_linked_to_other_organization`: the tenant already
  belongs to another organization. `replace` does not override this; unlink
  that organization first.
- `422`, status `unknown_organization`: no such Optimize organization.
- `400`: bad JSON or body. `401`: wrong or missing Bearer token. `404`: secret
  unset or too short. `500`: retry; a retry gets the clear answer above.

Relinking the same pair changes nothing (`unchanged`, original `linkedAt` and
`linkedBy` kept). Deleting an organization deletes its link.

## Log

Each change writes one JSON line to the unit journal with the event
(`tenant_link.linked`, `tenant_link.replaced`, `tenant_link.unlinked`), the
organization id, the tenant id, the actor and, on replace, the previous tenant
id. The secret is never logged. Read them with
`journalctl -u lunar-optimize | grep tenant_link`.
