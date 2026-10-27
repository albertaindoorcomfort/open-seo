import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

function SupportPage() {
  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-8 pb-24 md:px-6 md:py-12 md:pb-8">
      <div className="mx-auto max-w-xl">
        <p className="text-sm font-medium text-base-content/40">
          Project Lunar
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Contact and support
        </h1>
        <p className="mt-2 text-sm text-base-content/60">
          For questions about Lunar Optimize, contact Project Lunar through its
          published contact address.
        </p>
        <a
          className="mt-8 block rounded-lg border border-base-300 px-5 py-4 text-sm font-medium hover:border-base-content/20"
          href="mailto:xander@lunar-project.com"
        >
          xander@lunar-project.com
        </a>
      </div>
    </div>
  );
}
