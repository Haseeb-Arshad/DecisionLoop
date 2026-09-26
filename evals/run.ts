/**
 * npm run eval [-- --model]  — runs the behavioural evaluation against an
 * embedded database (or DATABASE_URL) and writes evals/reports/latest.{md,json}.
 * `--model` uses the configured reasoning provider instead of the scripted
 * stand-in (costs model calls).
 */
import fs from "node:fs";
import path from "node:path";
import { startMigratedEmbeddedDatabase } from "@decisionloop/storage-sql/embedded";
import { renderReport, runEvaluation } from "./runner";

async function main() {
  const useConfiguredModel = process.argv.includes("--model");
  let url = process.env.DATABASE_URL;
  const embedded = url ? null : await startMigratedEmbeddedDatabase({ migrationsDir: path.join(process.cwd(), "db", "migrations") });
  if (embedded) {
    await embedded.sql.end();
    url = embedded.url;
  }
  try {
    const report = await runEvaluation({ databaseUrl: url!, useConfiguredModel });
    const dir = path.join(process.cwd(), "evals", "reports");
    fs.mkdirSync(dir, { recursive: true });
    const md = renderReport(report);
    fs.writeFileSync(path.join(dir, "latest.md"), `${md}\n`);
    fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${md}\n`);
    if (report.cases.some((c) => !c.pass)) process.exitCode = 1;
  } finally {
    await embedded?.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
