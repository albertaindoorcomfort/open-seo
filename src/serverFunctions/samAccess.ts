import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSamAccessStatus } from "@/server/features/sam/samAccess";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

// Gates the in-app AI agent (SAM) on an OpenRouter key being configured, the
// same way backlinks/AI-search gate on their DataForSEO subscriptions.
export const getSamAccessSetupStatus = createServerFn({ method: "GET" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(() => getSamAccessStatus());
