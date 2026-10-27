import { Navigate, createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/lib/auth-client";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import {
  WelcomePage,
  landingHead,
} from "@/client/features/lunar-optimize/WelcomePage";

export const Route = createFileRoute("/")({
  head: landingHead,
  component: HomePage,
});

function HomePage() {
  const { data: session, isPending } = useSession();
  if (!isHostedClientAuthMode() || (!isPending && session?.user?.id)) {
    return <Navigate to="/workspace" replace />;
  }
  return <WelcomePage />;
}
