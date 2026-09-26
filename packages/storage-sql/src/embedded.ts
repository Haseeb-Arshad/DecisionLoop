import { createSql, type Sql } from "./connection";

/**
 * Embedded PostgreSQL (PGlite + pgvector) served over the Postgres wire
 * protocol on localhost, so the *same* postgres.js code paths used against
 * CockroachDB run unchanged. This is what lets someone try DecisionLoop
 * without provisioning any database, and what lets every DB-backed test run
 * in CI.
 *
 * `dataDir` persists to disk (state survives restarts); omit it for an
 * in-memory database (tests).
 *
 * PGlite is single-connection; pglite-socket multiplexes client connections
 * onto it and serializes their queries. Fine for local use and tests — not a
 * production database.
 */
export interface EmbeddedDatabase {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export async function startEmbeddedDatabase(
  opts: { dataDir?: string; port?: number; host?: string } = {},
): Promise<EmbeddedDatabase> {
  // Loaded lazily: these are development/local-mode dependencies and must
  // never be pulled into the Next.js server bundle or a CockroachDB deploy.
  const [{ PGlite }, { vector }, { PGLiteSocketServer }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite-pgvector"),
    import("@electric-sql/pglite-socket"),
  ]);

  const db = await PGlite.create({
    dataDir: opts.dataDir,
    extensions: { vector },
  });
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");

  const host = opts.host ?? "127.0.0.1";
  const server = new PGLiteSocketServer({ db, port: opts.port ?? 0, host, maxConnections: 32 });
  await server.start();

  const address = (
    server as unknown as { server?: { address(): { port: number } | string | null } }
  ).server?.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
  if (!port) throw new Error("Embedded database did not report a listening port.");

  return {
    url: `postgres://postgres@${host}:${port}/postgres?sslmode=disable`,
    port,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}

/** Convenience for tests and the CLI: an embedded DB with migrations applied. */
export async function startMigratedEmbeddedDatabase(opts: {
  dataDir?: string;
  port?: number;
  migrationsDir: string;
}): Promise<EmbeddedDatabase & { sql: Sql }> {
  const embedded = await startEmbeddedDatabase(opts);
  const sql = createSql(embedded.url, { max: 1 });
  const { runMigrations } = await import("./migrate");
  await runMigrations(sql, { dir: opts.migrationsDir, dialect: "postgres" });
  return {
    ...embedded,
    sql,
    async stop() {
      await sql.end({ timeout: 5 });
      await embedded.stop();
    },
  };
}
