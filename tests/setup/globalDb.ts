import path from "node:path";
import type { TestProject } from "vitest/node";
import { startMigratedEmbeddedDatabase } from "../../packages/storage-sql/src/embedded";

/**
 * DB-backed tests used to skip unless a CockroachDB Cloud URL was supplied,
 * so in practice none of them ran. Now: if DATABASE_URL is set (CockroachDB
 * or PostgreSQL), tests use it; otherwise an in-memory embedded PostgreSQL
 * (PGlite + pgvector) is started, migrated, and handed to every worker.
 */
export default async function setup(project: TestProject) {
  if (process.env.DATABASE_URL || process.env.DECISIONLOOP_TEST_NO_DB === "1") return;

  const db = await startMigratedEmbeddedDatabase({
    migrationsDir: path.join(process.cwd(), "db", "migrations"),
  });
  await db.sql.end({ timeout: 5 });
  process.env.DATABASE_URL = db.url;
  // pglite-socket serializes per TCP chunk, not per protocol Sync cycle, so
  // concurrent connections can interleave unnamed-statement Parse/Bind
  // messages. One connection per process is the safe embedded setting.
  process.env.DATABASE_POOL_MAX = "1";
  project.provide("embeddedDatabaseUrl", db.url);

  return async () => {
    await db.stop().catch(() => undefined);
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    embeddedDatabaseUrl: string;
  }
}
