// oxlint-disable-next-line import/no-unassigned-import -- a side effect by design: zod must be jitless before any schema below is built
import "@/lib/zod-jitless";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { globalServerFunctionMiddleware } from "@/serverFunctions/middleware";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: globalServerFunctionMiddleware,
}));
