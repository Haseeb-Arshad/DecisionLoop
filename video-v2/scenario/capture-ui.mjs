// Captures the product UI for the film from the live Riverton workspace.
//   node capture-ui.mjs <base-url> <out-dir>
// Frames are 1920x1080 (1440x810 CSS pixels at a 4/3 device ratio) so text stays legible in the film.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve(import.meta.dirname, "../../package.json"));
const { chromium } = require("@playwright/test");
const [base = "http://localhost:4520", out = path.resolve(import.meta.dirname, "../film/public/ui")] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const settle = async () => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
};
const shot = async (name, opts = {}) => {
  await page.screenshot({ path: path.join(out, `${name}.png`), ...opts });
  console.log("wrote", name);
};

// A throwaway local account for the scratch workspace.
await page.goto(`${base}/signup`);
await settle();
await page.getByLabel("Your name").fill("Maya Okafor");
await page.getByLabel("Email").fill("maya@riverton.example.test");
await page.getByLabel("Password").fill("riverton-film-7Qx29");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL("**/dashboard");
await settle();
await shot("overview");

await page.goto(`${base}/at-risk`);
await settle();
await shot("at-risk");

await page.goto(`${base}/decisions`);
await settle();
const href = await page.locator('a:has-text("Build the new Eastbank primary school")').first().getAttribute("href");
await page.goto(`${base}${href}`);
await settle();
await shot("decision");
await shot("decision-full", { fullPage: true });

await page.goto(`${base}/approvals`);
await settle();
await shot("reviews");

await page.goto(`${base}/ask`);
await settle();
await page.fill("#act-action", "Approve a permit for a 60-bed care home at 12 Quay Road, east bank");
await page.fill("#act-resources", "zone:east_bank");
await page.fill('input[aria-label="Value name"]', "vulnerable_use");
await page.fill('input[aria-label="Value"]', "true");
await page.click('button:has-text("Check action")');
await page.waitForSelector("text=Advisory only");
await page.waitForTimeout(600);
// Frame the form and its verdict together: scroll so the result sits at the bottom of the view.
await page.evaluate(() => {
  const result = document.querySelector('[aria-live="polite"]');
  if (result) window.scrollTo(0, result.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 32);
});
await page.waitForTimeout(400);
await shot("check");

await page.goto(`${base}/agents`);
await settle();
const session = await page.locator('a:has-text("permit-agent")').first().getAttribute("href");
await page.goto(`${base}${session}`);
await settle();
await shot("agent");

await browser.close();
