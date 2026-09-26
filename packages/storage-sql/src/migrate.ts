import fs from "node:fs";
import path from "node:path";
import type { Dialect, Sql } from "./connection";
import { detectDialect } from "./connection";

/**
 * Dialect-aware migration runner (CockroachDB, PostgreSQL + pgvector, and
 * embedded PGlite, which is PostgreSQL).
 *
 * Statements within a file are split and executed one at a time — a
 * CockroachDB requirement, not a style choice: several combinations of
 * schema changes and writes cannot share one transaction there.
 *
 * Dialect handling is deliberately narrow and visible:
 *  - Files named `*.cockroach.*` run only on CockroachDB; `*.postgres.*`
 *    only on PostgreSQL. `0002_vector_index.optional.sql` predates that
 *    convention and is CockroachDB-only (C-SPANN `CREATE VECTOR INDEX`).
 *  - On PostgreSQL, historical migrations' `STRING` type is rewritten to
 *    `TEXT` (CockroachDB treats them as aliases). Applied migration files
 *    are never edited on disk, because live clusters have recorded them.
 *  - On PostgreSQL, the `vector` extension is created first.
 *
 * A file containing `.optional.` may fail; the failure is recorded as a
 * warning and the file is marked applied. Successful statements are
 * recorded individually so a later run resumes after a mid-file failure.
 */

const COCKROACH_ONLY_FILES = new Set(["0002_vector_index.optional.sql"]);

/**
 * Deliberately simple: strips `--` line comments, then splits on `;`.
 * Sufficient because migrations here are plain DDL/DML with no `$$` bodies
 * and no semicolons inside string literals; the guard fails loudly rather
 * than silently mis-splitting if that ever changes.
 */
export function splitSqlStatements(sql: string): string[] {
  if (sql.includes("$$")) {
    throw new Error(
      "Migration contains a $$-quoted block, which the simple statement splitter " +
        "cannot handle. Split the migration into separate files or upgrade the splitter.",
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

export function appliesToDialect(file: string, dialect: Dialect): boolean {
  if (file.includes(".cockroach.") || COCKROACH_ONLY_FILES.has(file)) return dialect === "cockroach";
  if (file.includes(".postgres.")) return dialect === "postgres";
  return true;
}

export function adaptStatement(statement: string, dialect: Dialect): string {
  return dialect === "postgres" ? statement.replace(/\bSTRING\b/g, "TEXT") : statement;
}

/**
 * A previous runner version could apply a rename and then crash before the
 * file-level migration row was written. Treat that one already-completed
 * schema change as progress when the statement ledger sees it first.
 */
async function renameAlreadyApplied(sql: Sql, statement: string): Promise<boolean> {
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
  if (!columns.has(oldColumn) && columns.has(newColumn)) return true;
  if (columns.has(oldColumn) && columns.has(newColumn)) {
    throw new Error(`Cannot resume rename on ${tableName}: both ${oldColumn} and ${newColumn} exist.`);
  }
  return false;
}

export interface MigrationLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface MigrationResult {
  dialect: Dialect;
  applied: string[];
  skipped: string[];
  warnings: Array<{ file: string; message: string }>;
}

export async function runMigrations(
  sql: Sql,
  opts: { dir: string; dialect?: Dialect; log?: MigrationLog },
): Promise<MigrationResult> {
  const log = opts.log ?? { info: () => {}, warn: () => {} };
  const dialect = opts.dialect ?? (await detectDialect(sql));
  const result: MigrationResult = { dialect, applied: [], skipped: [], warnings: [] };

  if (dialect === "postgres") {
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS vector");
  }

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      warning TEXT
    )
  `);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migration_statements (
      filename TEXT NOT NULL,
      statement_index INT8 NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (filename, statement_index)
    )
  `);

  const files = fs
    .readdirSync(opts.dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (!appliesToDialect(file, dialect)) {
      log.info(`n/a    ${file} (not for ${dialect})`);
      result.skipped.push(file);
      continue;
    }
    const alreadyApplied = await sql`SELECT 1 FROM schema_migrations WHERE filename = ${file}`;
    if (alreadyApplied.length > 0) {
      log.info(`skip   ${file} (already applied)`);
      result.skipped.push(file);
      continue;
    }

    const contents = fs.readFileSync(path.join(opts.dir, file), "utf8");
    const isOptional = file.includes(".optional.");
    const statements = splitSqlStatements(contents);

    try {
      for (const [statementIndex, raw] of statements.entries()) {
        const completed = await sql`
          SELECT 1 FROM schema_migration_statements
          WHERE filename = ${file} AND statement_index = ${statementIndex}
        `;
        if (completed.length > 0) {
          log.info(`resume ${file} statement ${statementIndex + 1}/${statements.length}`);
          continue;
        }
        const statement = adaptStatement(raw, dialect);
        if (!(await renameAlreadyApplied(sql, statement))) {
          await sql.unsafe(statement);
        }
        await sql`
          INSERT INTO schema_migration_statements (filename, statement_index)
          VALUES (${file}, ${statementIndex})
          ON CONFLICT (filename, statement_index) DO NOTHING
        `;
      }
      await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      log.info(`apply  ${file} (${statements.length} statement${statements.length === 1 ? "" : "s"})`);
      result.applied.push(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isOptional) {
        throw new Error(`Migration ${file} failed: ${message}`);
      }
      log.warn(`skip*  ${file} — optional migration failed, continuing. reason: ${message}`);
      await sql`INSERT INTO schema_migrations (filename, warning) VALUES (${file}, ${message})`;
      result.warnings.push({ file, message });
    }
  }

  return result;
}
