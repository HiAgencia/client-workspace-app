import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    setupFiles: ["tests/setup/env.ts"],
    // Integration tests talk to the real Supabase project over the network.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      // The logic beside its code: nothing of the network, so a run of these alone asks no service.
      { test: { name: "unit", include: ["src/**/*.test.ts"] } },
      // Against the real project: the run's setup deletes what a cut run left, and fails a run that leaves a test user
      // behind.
      { test: { name: "integration", include: ["tests/**/*.test.ts"], globalSetup: ["tests/setup/users.ts"] } },
    ],
  },
});
