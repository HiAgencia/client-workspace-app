import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

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
      // What runs without the network —the logic beside its code, and the suite's own helpers—, so a run of these alone
      // asks no service.
      { test: { name: "unit", include: ["src/**/*.test.ts", "tests/support/**/*.test.ts"] } },
      // Against the real project: the run's setup deletes what a cut run left, and fails a run that leaves a test user
      // behind.
      {
        test: {
          name: "integration",
          include: ["tests/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/support/**"],
          globalSetup: ["tests/setup/users.ts"],
        },
      },
    ],
  },
});
