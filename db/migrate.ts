/**
 * Migration runner. Applies every .sql file in db/migrations, in filename
 * order, tracked in a `schema_migrations` table so re-runs are idempotent.
 *
 * A migration filename containing ".optional." is allowed to fail — its
 * error is logged as a warning and it's still marked applied. This is used
 * for the C-SPANN vector index (0002), which requires CockroachDB v25.2+;
 * on older Serverless clusters the app falls back to a brute-force vector
 * scan instead (see lib/repo/memoryChunks.ts).
 *
 * Usage: npm run db:migrate
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local first.",
    );
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename STRING PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      warning STRING
    )
  `;

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found in db/migrations.");
  }

  for (const file of files) {
    const alreadyApplied = await sql`
      SELECT 1 FROM schema_migrations WHERE filename = ${file}
    `;
    if (alreadyApplied.length > 0) {
      console.log(`skip   ${file} (already applied)`);
      continue;
    }

    const contents = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const isOptional = file.includes(".optional.");

    try {
      await sql.unsafe(contents);
      await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      console.log(`apply  ${file}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isOptional) {
        console.warn(`skip*  ${file} — optional migration failed, continuing.`);
        console.warn(`       reason: ${message}`);
        await sql`
          INSERT INTO schema_migrations (filename, warning)
          VALUES (${file}, ${message})
        `;
      } else {
        console.error(`FAIL   ${file}`);
        console.error(message);
        await sql.end();
        process.exit(1);
      }
    }
  }

  await sql.end();
  console.log("\nMigrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
