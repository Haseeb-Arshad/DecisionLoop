import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // Unit tests run anywhere with no infrastructure. Integration tests
    // require a real CockroachDB and skip themselves without DATABASE_URL
    // (see tests/integration/*). E2E lives under tests/e2e and runs with
    // Playwright, not vitest — see docs/deployment.md.
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests share a database; running their files in parallel
    // would interleave tenant setup and teardown.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
