import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environment: "node",
    // No test may reach a paid data provider (src/test-setup/no-paid-network.ts).
    setupFiles: ["./src/test-setup/no-paid-network.ts"],
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
    server: {
      deps: {
        // Processed by vitest (instead of loaded natively by node) so the
        // oauth-refresh e2e test's cloudflare:workers mock reaches the real
        // provider module.
        inline: ["@cloudflare/workers-oauth-provider"],
      },
    },
  },
});
