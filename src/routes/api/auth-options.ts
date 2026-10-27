import { createFileRoute } from "@tanstack/react-router";

// Public (no session): what this deployment's sign-in and sign-up offer, so
// the landing and auth pages only promise what works. Booleans only. A file
// route rather than a server function, because every server function requires
// a session (globalServerFunctionMiddleware) and these pages are signed out.
async function handleAuthOptionsRequest(): Promise<Response> {
  const { hasGoogleSocialConfig, hasHostedAuthEmailConfig } =
    await import("@/lib/auth");
  const { isSignupInviteOnly } = await import("@/server/auth/signup-allowlist");
  return Response.json(
    {
      google: hasGoogleSocialConfig(),
      // Without a mail provider no reset link can be sent.
      passwordResetEmail: hasHostedAuthEmailConfig(),
      inviteOnly: await isSignupInviteOnly(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/auth-options")({
  server: {
    handlers: {
      GET: () => handleAuthOptionsRequest(),
    },
  },
});
