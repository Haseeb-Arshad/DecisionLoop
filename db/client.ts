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

function getOrCreateClient(): ReturnType<typeof postgres> {
  if (!globalThis.__decisionloop_sql__) {
    globalThis.__decisionloop_sql__ = createClient();
  }
  return globalThis.__decisionloop_sql__;
}

// `sql` is a lazy proxy, not a live connection created at import time. Next.js
// executes server-component modules during `next build` (route analysis,
// "Collecting page data") even for routes that never touch the DB at build
// time — eagerly connecting here would make a missing DATABASE_URL a build
// failure instead of a runtime one. The proxy defers both the "is it set"
// check and the actual TCP connection until the first real query.
export const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  apply(_target, _thisArg, args) {
    return (getOrCreateClient() as any)(...args);
  },
  get(_target, prop) {
    return (getOrCreateClient() as any)[prop];
  },
});

export type Sql = typeof sql;

/**
 * postgres.js types `sql.json()` against its own recursive JSONValue union,
 * which our domain types (built from `unknown`-bearing interfaces) don't
 * structurally satisfy even though they're always plain JSON at runtime.
 * This is the one sanctioned escape hatch for that — use it instead of an
 * inline `as any` so every JSONB write goes through one visibly-named spot.
 */
export function toJsonValue(value: unknown): any {
  return value;
}
