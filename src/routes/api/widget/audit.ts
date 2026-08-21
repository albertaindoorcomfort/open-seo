import { createFileRoute } from "@tanstack/react-router";
import { handlePublicWidgetAuditRequest } from "@/server/features/widget-audit/publicWidgetAuditRuntime";

export const Route = createFileRoute("/api/widget/audit")({
  server: {
    handlers: {
      POST: ({ request }) => handlePublicWidgetAuditRequest(request),
      OPTIONS: ({ request }) => handlePublicWidgetAuditRequest(request),
    },
  },
});
