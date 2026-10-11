import { defineConfig } from "vitest/config";

// Runs against the shared Compose stack (`pnpm infra:up`), never against private containers.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One file at a time: the suites share the support database and consumer group.
    fileParallelism: false,
  },
});
