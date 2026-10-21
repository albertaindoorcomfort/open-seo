# Apollo module bridge

AIC OS (Apollo) calls OpenSEO as a remote module: `POST /aic/tools/<tool>`,
signed with HMAC-SHA256 over `${x-aic-timestamp}.${rawBody}` and sent as
`x-aic-signature: v1=<hex>`. The handler is
`src/integrations/apollo/module-bridge.ts`.

## What it accepts

| Apollo tool                  | OpenSEO MCP tool                 | Needs an Apollo approval |
| ---------------------------- | -------------------------------- | ------------------------ |
| `openseo.site_audit`         | `run_site_audit`                 | yes, spends credits      |
| `openseo.keyword_research`   | `research_keywords`              | yes, spends credits      |
| `openseo.search_performance` | `get_search_console_performance` | no                       |

Apollo's gate approves the spending tools before it signs. The bridge also
refuses them without an `approvalId`, so a leaked secret alone cannot spend.

## How a call runs

1. Verify the signature and a timestamp within 5 minutes. Nothing in the
   body is read before this.
2. Look up the tenant in `AIC_TENANT_LINKS`. An unlinked tenant gets 403.
3. Re-check the arguments, add the linked `projectId`, and call OpenSEO's own
   `/mcp` route in-process with the tenant's API key. API key auth, project
   authz, credit billing and rate limits apply as for any other client.
4. Answer `{ result }`, or `{ error, details }`. A 422 is final, a 502 is
   retryable.

## Configuration

- `AIC_MODULE_SECRET`: at least 32 characters; the same value as Apollo's
  `AIC_MODULE_SECRET_OPENSEO`.
- `AIC_TENANT_LINKS`: JSON, `{"<tenantId>": {"projectId": "...", "apiKey": "oseo_..."}}`.
  The API key may be left out only on a self-hosted instance in
  `AUTH_MODE=local_noauth`. `cloudflare_access` mode is not supported, since
  the in-process call carries no Access token.

Set both as secrets. Without them every call is refused.
