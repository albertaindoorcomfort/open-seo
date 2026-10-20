// OpenSEO MCP tools exposed to Apollo (the AIC OS control plane) as agent
// tools. Apollo names tools `module.action` and gates each one on a
// `resource:action` permission; OpenSEO keeps validating the arguments, so
// this file maps names and access classes only and never copies input schemas.
//
// Permissions reuse Apollo's existing grants: `research:read` for free reads of
// OpenSEO state, `research:execute` for calls that spend DataForSEO credits or
// start background work, `analytics:read` for first-party Google data. Delete
// tools are left out on purpose: agents get no destructive OpenSEO access.

type ApolloPermission = "research:read" | "research:execute" | "analytics:read";

type OpenSeoApolloTool = {
  mcpTool: string;
  permission: ApolloPermission;
  /** True when the call can charge OpenSEO credits. */
  spendsCredits: boolean;
};

export const OPENSEO_APOLLO_TOOLS = {
  "seo.whoami": {
    mcpTool: "whoami",
    permission: "research:read",
    spendsCredits: false,
  },
  "seo.list_projects": {
    mcpTool: "list_projects",
    permission: "research:read",
    spendsCredits: false,
  },
  "seo.create_project": {
    mcpTool: "create_project",
    permission: "research:execute",
    spendsCredits: false,
  },
  "seo.get_project_context": {
    mcpTool: "get_project_context",
    permission: "research:read",
    spendsCredits: false,
  },
  "seo.audit_start": {
    mcpTool: "run_site_audit",
    permission: "research:execute",
    spendsCredits: true,
  },
  "seo.audit_status": {
    mcpTool: "get_audit_status",
    permission: "research:read",
    spendsCredits: false,
  },
  "seo.audit_issues": {
    mcpTool: "get_audit_issues",
    permission: "research:read",
    spendsCredits: false,
  },
  "seo.audit_pages": {
    mcpTool: "get_audit_pages",
    permission: "research:read",
    spendsCredits: false,
  },
  "seo.keyword_research": {
    mcpTool: "research_keywords",
    permission: "research:execute",
    spendsCredits: true,
  },
  "seo.keyword_metrics": {
    mcpTool: "get_keyword_metrics",
    permission: "research:execute",
    spendsCredits: true,
  },
  "seo.domain_overview": {
    mcpTool: "get_domain_overview",
    permission: "research:execute",
    spendsCredits: true,
  },
  "seo.serp_results": {
    mcpTool: "get_serp_results",
    permission: "research:execute",
    spendsCredits: true,
  },
  "seo.local_serp_results": {
    mcpTool: "get_local_serp_results",
    permission: "research:execute",
    spendsCredits: true,
  },
  "seo.gsc_performance": {
    mcpTool: "get_search_console_performance",
    permission: "analytics:read",
    spendsCredits: false,
  },
  "seo.gsc_inspect_urls": {
    mcpTool: "inspect_urls",
    permission: "analytics:read",
    spendsCredits: false,
  },
  "seo.search_opportunities": {
    mcpTool: "get_search_opportunities",
    permission: "analytics:read",
    spendsCredits: false,
  },
  "seo.ga4_organic_overview": {
    mcpTool: "get_google_analytics_organic_overview",
    permission: "analytics:read",
    spendsCredits: false,
  },
  "seo.ga4_landing_pages": {
    mcpTool: "get_google_analytics_organic_landing_pages",
    permission: "analytics:read",
    spendsCredits: false,
  },
  "seo.ga4_key_events": {
    mcpTool: "get_google_analytics_key_events",
    permission: "analytics:read",
    spendsCredits: false,
  },
} as const satisfies Record<string, OpenSeoApolloTool>;

type OpenSeoApolloToolName = keyof typeof OPENSEO_APOLLO_TOOLS;

export function isOpenSeoApolloTool(
  name: string,
): name is OpenSeoApolloToolName {
  return Object.hasOwn(OPENSEO_APOLLO_TOOLS, name);
}
