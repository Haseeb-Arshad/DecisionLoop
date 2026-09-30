import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

/** Same precedence as Next; exported shell variables always win. */
export function loadEnvironment(dir = process.cwd(), env = process.env): void {
  const mode = env.NODE_ENV || "development";
  const files = [
    `.env.${mode}.local`,
    ...(mode === "test" ? [] : [".env.local"]),
    `.env.${mode}`,
    ".env",
  ];
  for (const file of files) {
    const name = path.join(dir, file);
    if (!fs.existsSync(name)) continue;
    for (const [key, value] of Object.entries(parse(fs.readFileSync(name)))) {
      if (env[key] === undefined) env[key] = value;
    }
  }
}
loadEnvironment();
