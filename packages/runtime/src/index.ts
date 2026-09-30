import fs from "node:fs";
import path from "node:path";
import { createDecisionLoop, type DecisionLoop, type Logger } from "@decisionloop/core/services/index";
import { selectEmbeddingProvider, selectReasoningProvider } from "@decisionloop/providers";
import { createSql, type Sql } from "@decisionloop/storage-sql/connection";
import { startEmbeddedDatabase, type EmbeddedDatabase } from "@decisionloop/storage-sql/embedded";
import { runMigrations } from "@decisionloop/storage-sql/migrate";
import { SqlDecisionStore } from "@decisionloop/storage-sql/store";
import { loadDomainRegistry } from "./profiles";

export * from "./apiKeys";
export * from "./profiles";

/**
 * Wires a DecisionLoop instance from configuration. Every process — the
 * local server, the worker, the web app, tests — builds its instance here
 * so provider selection and storage setup exist once.
 *
 *   DATABASE_URL        CockroachDB or PostgreSQL (+pgvector). When absent
 *                       and `embedded` is allowed, an embedded PostgreSQL is
 *                       started with its data in `.decisionloop/pgdata`.
 */

export interface Runtime {
  sql: Sql;
  loop: DecisionLoop;
  databaseUrl: string;
  embedded: boolean;
  stop(): Promise<void>;
}

export interface RuntimeOptions {
  databaseUrl?: string | null;
  /** Start an embedded database when no URL is configured. */
  allowEmbedded?: boolean;
  dataDir?: string;
  embeddedPort?: number;
  migrate?: boolean;
  migrationsDir?: string;
  poolMax?: number;
  logger?: Logger;
  env?: Record<string, string | undefined>;
}

export function findMigrationsDir(start = process.cwd()): string {
  const candidates = [process.env.DECISIONLOOP_MIGRATIONS_DIR, path.join(start, "db", "migrations")].filter(
    (c): c is string => Boolean(c),
  );
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`Could not find db/migrations (looked in ${candidates.join(", ")}). Set DECISIONLOOP_MIGRATIONS_DIR.`);
  return found;
}

export async function createRuntime(opts: RuntimeOptions = {}): Promise<Runtime> {
  const env = opts.env ?? process.env;
  let url = opts.databaseUrl ?? env.DATABASE_URL ?? null;
  let embedded: EmbeddedDatabase | null = null;

  if (!url) {
    if (!opts.allowEmbedded) {
      throw new Error("DATABASE_URL is not set. Set it, or run `decisionloop serve` to use the embedded database.");
    }
    const dataDir = opts.dataDir ?? path.join(process.cwd(), ".decisionloop", "pgdata");
    fs.mkdirSync(dataDir, { recursive: true });
    embedded = await startEmbeddedDatabase({ dataDir, port: opts.embeddedPort });
    url = embedded.url;
  }

  // The embedded server multiplexes connections per TCP chunk, not per
  // protocol cycle; one connection per process keeps it correct.
  const sql = createSql(url, { max: embedded ? 1 : (opts.poolMax ?? Number(env.DATABASE_POOL_MAX ?? 10)), applicationName: "decisionloop" });
  if (opts.migrate || embedded) {
    await runMigrations(sql, { dir: opts.migrationsDir ?? findMigrationsDir() });
  }

  const loop = createDecisionLoop({
    store: new SqlDecisionStore(sql),
    embeddings: selectEmbeddingProvider(env),
    reasoning: selectReasoningProvider(env),
    domains: loadDomainRegistry(env),
    logger: opts.logger,
  });

  return {
    sql,
    loop,
    databaseUrl: url,
    embedded: Boolean(embedded),
    async stop() {
      await sql.end({ timeout: 5 });
      await embedded?.stop();
    },
  };
}
