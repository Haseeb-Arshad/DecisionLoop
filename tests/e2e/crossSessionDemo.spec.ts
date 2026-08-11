import { expect, test } from "@playwright/test";

/**
 * decision.md §46 — the most important automated test: the core story,
 * end-to-end, in a real browser, against a real deployment.
 *
 * The load-bearing part is the session boundary. Session 2 runs in a
 * completely separate browser context with its own cookie jar and storage.
 * If the "memory" were living in React state, localStorage, or a server
 * cache keyed to the first session, this test fails — the only thing that
 * survives between the two halves is CockroachDB.
 *
 * Run against a deployed environment:
 *   E2E_BASE_URL=https://your-app npx playwright test
 *
 * Requires a workspace seeded with `npm run db:seed` credentials, or set
 * E2E_EMAIL / E2E_PASSWORD. Skips itself when E2E_BASE_URL is unset so it
 * never blocks a local `npm test`.
 */

const BASE_URL = process.env.E2E_BASE_URL;
const EMAIL = process.env.E2E_EMAIL ?? "maya.chen@northstar.example";
const PASSWORD = process.env.E2E_PASSWORD ?? "decisionloop-demo";

test.skip(!BASE_URL, "E2E_BASE_URL is not set — see docs/deployment.md");

test.describe.configure({ mode: "serial" });

test.describe("cross-session decision memory", () => {
  let decisionUrl: string;

  test("session 1: commit a decision into organizational memory", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(dashboard|decisions)/);

    await page.goto(`${BASE_URL}/decisions/new`);
    await page.getByLabel("Describe the decision").fill(
      "Choose our analytics infrastructure provider. We evaluated SignalForge and MetricLake. " +
        "Going with SignalForge — $20,000/year, meets our EU data residency requirement, and " +
        "handles our current 5 million events/day. MetricLake was rejected because its " +
        "Enterprise tier starts at $29,000/year, above our $25,000 budget, for capacity we " +
        "don't need yet. This depends on SignalForge staying below $25,000/year.",
    );

    await page.getByRole("button", { name: /^Analyse/ }).click();

    // Extraction calls Bedrock; allow real latency rather than a flaky short timeout.
    await expect(page.getByRole("button", { name: "Commit decision" })).toBeVisible({
      timeout: 120_000,
    });

    await expect(page.getByPlaceholder(/SignalForge pricing stays under/)).toHaveCount(1, {
      timeout: 5_000,
    });

    await page.getByRole("button", { name: "Commit decision" }).click();
    await page.waitForURL(/\/decisions\/[0-9a-f-]{36}/, { timeout: 60_000 });

    decisionUrl = page.url();
    await expect(page.getByText("Active")).toBeVisible();
    await expect(page.getByText("Assumptions DecisionLoop is watching")).toBeVisible();

    // Session 1 ends here. Everything client-side is thrown away.
    await context.close();
  });

  test("session 2: new evidence puts the decision at risk, with no prompting", async ({
    browser,
  }) => {
    // A brand-new context — no cookies, no storage, no in-memory state
    // carried over from session 1.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(dashboard|decisions)/);

    await page.goto(`${BASE_URL}/documents`);

    // Upload the renewal notice. Nothing in this file, or in this
    // interaction, references the decision committed in session 1.
    await page.setInputFiles(
      'input[type="file"]',
      "demo-data/signalforge-2027-pricing.md",
    );

    await expect(page.getByText(/conflict.* found/i)).toBeVisible({ timeout: 180_000 });
    await expect(page.getByRole("link", { name: /View decision now at risk/ })).toBeVisible();

    await page.getByRole("link", { name: /View decision now at risk/ }).first().click();
    await page.waitForURL(/\/decisions\/[0-9a-f-]{36}/);

    await expect(page.getByText("Decision at risk")).toBeVisible();
    await expect(page.getByText("Original assumption")).toBeVisible();
    await expect(page.getByText("New evidence")).toBeVisible();
    await expect(page.getByText(/42,?000/)).toBeVisible();

    await context.close();
  });

  test("the Memory Inspector proves which CockroachDB rows drove it", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(dashboard|decisions)/);

    await page.goto(`${BASE_URL}/inspector`);

    await expect(page.getByText("Rendered SQL (CockroachDB)")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Retrieved memories")).toBeVisible();
    await expect(page.getByText(/memory_chunks/)).toBeVisible();

    // Real similarity scores, not placeholders.
    await expect(page.locator("td.font-mono").first()).toHaveText(/^0\.\d{3}$/);

    await context.close();
  });

  test("decision detail keeps a timeline built from real memory events", async ({ browser }) => {
    test.skip(!decisionUrl, "session 1 did not produce a decision URL");

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(dashboard|decisions)/);

    await page.goto(decisionUrl);

    await expect(page.getByText("Memory timeline")).toBeVisible();
    await expect(page.getByText("Decision committed")).toBeVisible();

    await context.close();
  });
});
