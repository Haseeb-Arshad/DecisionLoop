// Headless render for the Motion Canvas project: opens the editor served by
// `npm run editor`, presses Render, and waits until the image sequence is
// complete. Motion Canvas renders only from its editor, so this drives it.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("../../package.json"));
const { chromium } = require("@playwright/test");

const url = process.env.MC_URL ?? "http://localhost:9100/";
const outDir = path.resolve("output");
const expected = Number(process.argv[2] ?? "0");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(3000);

// The render button lives in the Video Settings panel.
const renderButton = page.getByRole("button", { name: /^render$/i });
if (!(await renderButton.count())) {
  const tabs = await page.locator("button, [role=tab], [title]").evaluateAll((els) => els.map((e) => e.getAttribute("title") || e.textContent).filter(Boolean));
  console.log("render button not found; controls:", tabs.slice(0, 60));
}
await renderButton.first().click();

const count = () => (fs.existsSync(outDir) ? fs.readdirSync(outDir, { recursive: true }).filter((f) => String(f).endsWith(".png")).length : 0);
let last = -1;
let still = 0;
for (let i = 0; i < 3600; i++) {
  await page.waitForTimeout(1000);
  const n = count();
  if (n !== last) {
    last = n;
    still = 0;
    if (i % 5 === 0) console.log(`frames: ${n}`);
  } else if (++still > 8 && n > 0 && (!expected || n >= expected)) break;
}
console.log(`done: ${count()} frames in ${outDir}`);
await browser.close();
