/**
 * Migration runner. Applies every .sql file in db/migrations, in filename
 * order, tracked in a `schema_migrations` table so re-runs are idempotent.
 *
 * Statements within a file are split and executed one at a time. This is a
 * CockroachDB requirement in practice, not a stylistic choice: sending a
 * whole file as one simple query runs it in a single implicit transaction,
 * and CockroachDB rejects several combinations of schema changes in one
 * transaction ("schema change statement cannot follow a statement that has
 * written in the same transaction"). Mixed CREATE TABLE / ALTER TABLE /
 * UPDATE migrations like 0003 hit that immediately.
 *
 * A migration filename containing ".optional." is allowed to fail — its
 * error is logged as a warning and it's still marked applied. This is used
 * for the C-SPANN vector index (0002), which requires CockroachDB v25.2+;
 * on older Serverless clusters the app falls back to a brute-force vector
 * scan instead (see lib/repo/memoryChunks.ts).
 *
 * Successful statements are also recorded individually. CockroachDB schema
 * changes cannot all share one transaction, so this progress ledger lets a
 * later run resume after a known mid-file failure instead of replaying every
 * earlier statement.
 *
 * Usage: npm run db:migrate
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/**
 * Splits a migration file into individual statements.
 *
 * Deliberately simple: strips `--` line comments, then splits on `;`. That
 * is sufficient because migrations here are plain DDL/DML with no `$$`
 * function bodies and no semicolons inside string literals. If a future
 * migration needs either, this needs a real lexer — the guard below fails
 * loudly rather than silently mis-splitting.
 */
export function splitSqlStatements(sql: string): string[] {
  if (sql.includes("$$")) {
    throw new Error(
      "Migration contains a $$-quoted block, which the simple statement splitter " +
        "in db/migrate.ts cannot handle. Split the migration into separate files " +
        "or upgrade the splitter.",
    );
  }

  const withoutComments = sql
    .split("\n")
    .map((line) => {
      const commentStart = line.indexOf("--");
      return commentStart === -1 ? line : line.slice(0, commentStart);
    })
    .join("\n");

  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * A previous runner version could apply a rename and then crash before the
 * file-level migration row was written. Treat that one already-completed
 * schema change as progress when the new statement ledger sees it for the
 * first time. The migration files are trusted source, so parsing this narrow
 * DDL form is safer than swallowing arbitrary database errors.
 */
async function renameAlreadyApplied(
  sql: ReturnType<typeof postgres<Record<string, postgres.PostgresType>>>,
  statement: string,
): Promise<boolean> {
  const match = statement.match(
    /^ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+RENAME\s+COLUMN\s+([A-Za-z_][A-Za-z0-9_]*)\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)$/i,
  );
  if (!match) return false;

  const tableName = match[1]!;
  const oldColumn = match[2]!;
  const newColumn = match[3]!;
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${tableName}
      AND column_name IN (${oldColumn}, ${newColumn})
  `;
  const columns = new Set(rows.map((row) => String(row.column_name)));
  if (!columns.has(oldColumn) && columns.has(newColumn)) {
    return true;
  }
  if (columns.has(oldColumn) && columns.has(newColumn)) {
    throw new Error(
      `Cannot resume rename on ${tableName}: both ${oldColumn} and ${newColumn} exist.`,
    );
  }
  return false;
}

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
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migration_statements (
      filename STRING NOT NULL,
      statement_index INT8 NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (filename, statement_index)
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
    const statements = splitSqlStatements(contents);

    try {
      for (const [statementIndex, statement] of statements.entries()) {
        const completed = await sql`
          SELECT 1 FROM schema_migration_statements
          WHERE filename = ${file} AND statement_index = ${statementIndex}
        `;
        if (completed.length > 0) {
          console.log(`resume ${file} statement ${statementIndex + 1}/${statements.length}`);
          continue;
        }
        if (await renameAlreadyApplied(sql, statement)) {
          console.log(`resume ${file} statement ${statementIndex + 1}/${statements.length} (rename already present)`);
          await sql`
            INSERT INTO schema_migration_statements (filename, statement_index)
            VALUES (${file}, ${statementIndex})
            ON CONFLICT (filename, statement_index) DO NOTHING
          `;
          continue;
        }
        await sql.unsafe(statement);
        await sql`
          INSERT INTO schema_migration_statements (filename, statement_index)
          VALUES (${file}, ${statementIndex})
          ON CONFLICT (filename, statement_index) DO NOTHING
        `;
      }
      await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      console.log(`apply  ${file} (${statements.length} statement${statements.length === 1 ? "" : "s"})`);
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

// Only run when invoked directly (`npm run db:migrate`), so tests can import
// splitSqlStatements without opening a database connection.
if (process.argv[1] && process.argv[1].includes("migrate")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
