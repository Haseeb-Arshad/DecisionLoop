import postgres from "postgres";

/**
 * Shared CockroachDB connection pool for the whole app.
 *
 * We use raw `postgres` (porsager/postgres.js) rather than an ORM: CockroachDB
 * has real dialect differences from vanilla Postgres (index syntax, the
 * VECTOR type, some type-mapping quirks), and for a demo whose core claim is
 * "here is exactly the SQL that ran," hand-written parameterized SQL is more
 * legible than an ORM's generated queries — see docs/architecture.md §3.
 *
 * Field names stay snake_case end-to-end (no automatic camelCase transform):
 * the repo layer (lib/repo/*) is the single place snake_case becomes the
 * camelCase shapes the rest of the app uses. That keeps SQL results, `EXPLAIN`
 * output, and the Memory Inspector's "rendered SQL" panel all showing the
 * same column names a reader can grep for in the migrations.
 */
declare global {
  // eslint-disable-next-line no-var
  var __decisionloop_sql__: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and set your " +
        "CockroachDB Cloud connection string (see docs/architecture.md §10).",
    );
  }
  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // CockroachDB Serverless connection pooling doesn't play well with prepared statements.
    onnotice: () => {
      // CockroachDB emits a lot of informational NOTICEs (e.g. on IF NOT
      // EXISTS races) — don't spam server logs with them.
    },
  });
}

// Reuse the pool across Next.js hot-reloads / lambda warm invocations instead
// of leaking a new pool per reload.
export const sql = globalThis.__decisionloop_sql__ ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__decisionloop_sql__ = sql;
}

export type Sql = typeof sql;
