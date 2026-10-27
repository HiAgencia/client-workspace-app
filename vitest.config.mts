import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // Integration tests talk to the real Supabase project over the network.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // They share that project and its auth service; parallel files stalled on a lost response instead of failing, so
    // they run one file at a time (the serial run stays under three minutes).
    fileParallelism: false,
  },
});
