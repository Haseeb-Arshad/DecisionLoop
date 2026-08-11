import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a *deployed* environment by design — §61 is explicit
 * that localhost success does not mean deployment success. Point it at a
 * URL and give it credentials:
 *
 *   E2E_BASE_URL=https://your-app npx playwright test
 *
 * Without E2E_BASE_URL the spec skips itself, so `npm test` (vitest) stays
 * independent of any running server.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // The demo involves real Bedrock calls and document ingestion; these are
  // slow by nature, and tightening the timeout produces flakes rather than
  // faster feedback.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
