import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // Deletes what a cut run left, and fails a run that leaves a test user behind.
    globalSetup: ["tests/setup/users.ts"],
    // Integration tests talk to the real Supabase project over the network.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
