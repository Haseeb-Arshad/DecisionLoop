/**
 * Migration CLI. The runner itself — dialect detection, per-statement
 * execution, resumable progress ledger, optional migrations — lives in
 * packages/storage-sql/src/migrate.ts so the CLI, tests and the embedded
 * local database share it.
 *
 * Usage: npm run db:migrate   (reads DATABASE_URL; CockroachDB or PostgreSQL)
 */
import "dotenv/config";
import path from "node:path";
import { createSql } from "@decisionloop/storage-sql/connection";
import { runMigrations } from "@decisionloop/storage-sql/migrate";

export { splitSqlStatements } from "@decisionloop/storage-sql/migrate";

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local first, or run " +
        "`npm run decisionloop -- serve` for an embedded local database.",
    );
  }

  const sql = createSql(url, { max: 1 });
  try {
    const result = await runMigrations(sql, {
      dir: MIGRATIONS_DIR,
      log: { info: (m) => console.log(m), warn: (m) => console.warn(m) },
    });
    console.log(`\nMigrations complete (${result.dialect}).`);
  } finally {
    await sql.end();
  }
}

// Only run when invoked directly (`npm run db:migrate`), so tests can import
// splitSqlStatements without opening a database connection.
if (process.argv[1] && process.argv[1].includes("migrate")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
