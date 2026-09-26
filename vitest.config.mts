import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json `paths`. Order matters: the subpath alias must be
    // tried before the bare package alias.
    alias: [
      { find: /^@decisionloop\/([^/]+)\/(.*)$/, replacement: path.resolve(rootDir, "packages/$1/src/$2") },
      { find: /^@decisionloop\/([^/]+)$/, replacement: path.resolve(rootDir, "packages/$1/src") },
      { find: "@", replacement: path.resolve(rootDir, ".") },
    ],
  },
  test: {
    environment: "node",
    // Unit tests run anywhere with no infrastructure. Integration tests run
    // against an embedded PGlite database by default, or against a real
    // CockroachDB/PostgreSQL when DATABASE_URL is set (see tests/setup).
    // E2E lives under tests/e2e and runs with Playwright, not vitest.
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // Integration tests share a database; running their files in parallel
    // would interleave tenant setup and teardown.
    fileParallelism: false,
    globalSetup: ["tests/setup/globalDb.ts"],
    // Hermetic by default: no test may call a hosted model because a key
    // happens to be in the developer's environment.
    env: {
      DECISIONLOOP_EMBEDDING_PROVIDER: "lexical",
      DECISIONLOOP_REASONING_PROVIDER: "none",
    },
    testTimeout: 30_000,
  },
});
