import { createFileRoute } from "@tanstack/react-router";
import {
  WelcomePage,
  landingHead,
} from "@/client/features/lunar-optimize/WelcomePage";

export const Route = createFileRoute("/welcome")({
  head: landingHead,
  component: WelcomePage,
});
